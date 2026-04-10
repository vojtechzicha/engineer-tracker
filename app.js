import { admissionsConfig } from "./data/config.js";
import { sourceLibrary } from "./data/sources.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const sourceMap = new Map(sourceLibrary.map((source) => [source.id, source]));

function startOfDay(date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date) return startOfDay(value);
  return startOfDay(new Date(`${value}T00:00:00`));
}

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return startOfDay(result);
}

function addBusinessDays(date, businessDays) {
  let cursor = startOfDay(date);
  let remaining = businessDays;

  while (remaining > 0) {
    cursor = addDays(cursor, 1);
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) {
      remaining -= 1;
    }
  }

  return cursor;
}

function dayDiff(target, base) {
  return Math.round((startOfDay(target) - startOfDay(base)) / DAY_MS);
}

function getToday(config) {
  return parseDate(config.meta.todayOverride) ?? startOfDay(new Date());
}

function formatDate(value) {
  const date = parseDate(value);
  if (!date) return "nezadané";

  return new Intl.DateTimeFormat(admissionsConfig.meta.locale, {
    day: "numeric",
    month: "numeric",
    year: "numeric",
  }).format(date);
}

function formatRange(startDate, endDate) {
  if (!startDate && !endDate) return "bez data";
  if (!endDate || startDate === endDate) return formatDate(startDate);
  return `${formatDate(startDate)} - ${formatDate(endDate)}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function encodeLink(url) {
  return /^https?:/i.test(url) ? url : encodeURI(url);
}

function getByPath(object, path) {
  if (!path) return undefined;
  return path.split(".").reduce((current, key) => current?.[key], object);
}

function sourceChips(sourceIds = []) {
  return sourceIds
    .map((sourceId) => sourceMap.get(sourceId))
    .filter(Boolean)
    .map(
      (source) => `
        <a class="source-chip" href="${escapeHtml(encodeLink(source.url))}" target="_blank" rel="noreferrer">
          ${escapeHtml(source.title)}
        </a>
      `,
    )
    .join("");
}

function decisionBadge(decision) {
  switch (decision) {
    case "accepted":
      return { label: "Přijat", tone: "success" };
    case "rejected":
      return { label: "Nepřijat", tone: "danger" };
    case "conditional":
      return { label: "Podmíněně", tone: "warning" };
    case "withdrawn":
      return { label: "Staženo", tone: "neutral" };
    default:
      return { label: "Čeká se", tone: "accent" };
  }
}

function eventStatus(event, app, today) {
  const taskComplete = event.taskKey ? Boolean(getByPath(app.liveState, event.taskKey)) : false;
  const dueDate = parseDate(event.endDate ?? event.date ?? event.startDate);
  const overdue = event.actor === "Ty" && !taskComplete && dueDate && dayDiff(today, dueDate) > 0;

  if (taskComplete) return "done";
  if (event.kind === "conditional") return "conditional";
  if (overdue) return "overdue";
  return "pending";
}

function overlaps(startA, endA, startB, endB) {
  const aStart = parseDate(startA);
  const aEnd = parseDate(endA ?? startA);
  const bStart = parseDate(startB);
  const bEnd = parseDate(endB ?? startB);
  if (!aStart || !aEnd || !bStart || !bEnd) return false;
  return aStart <= bEnd && bStart <= aEnd;
}

function getConflictBadges(event, bachelorEvents) {
  return bachelorEvents.filter((bachelorEvent) =>
    overlaps(
      event.date ?? event.startDate,
      event.endDate ?? event.date ?? event.startDate,
      bachelorEvent.startDate,
      bachelorEvent.endDate,
    ),
  );
}

function buildFekCalculation(app) {
  if (app.id !== "zcu-fek-pem-k") return null;
  const average = app.liveState.weightedAverage;
  const extras = app.liveState.extras ?? {};

  if (average == null || Number.isNaN(Number(average))) {
    return { ready: false, headline: "Doplň weightedAverage a bonusové přepínače v configu." };
  }

  const numericAverage = Number(average);
  const p = Number(((4 - numericAverage) * 10).toFixed(2));
  const b = extras.fieldBonusEligible ? 10 : 0;
  const kp = extras.thesisAward ? 10 : 0;
  const zs = extras.foreignInternship10Days ? 5 : 0;
  const total = Number((p + b + kp + zs).toFixed(2));

  let status = "eligible";
  let label = "Může stačit podle kapacity";
  if (total < 15) {
    status = "danger";
    label = "Pod minimem pro přijetí";
  } else if (total >= 30) {
    status = "success";
    label = "Garantované přijetí";
  }

  return { ready: true, total, status, label, breakdown: { p, b, kp, zs } };
}

function buildTulCondition(app) {
  if (app.id !== "tul-mpp-k") return null;
  const average = app.liveState.weightedAverage;

  if (average == null || Number.isNaN(Number(average))) {
    return { examRequired: null, label: "Nejprve doplň weightedAverage do configu." };
  }

  const numericAverage = Number(average);
  if (numericAverage <= 2.5) {
    return { examRequired: false, label: `Průměr ${numericAverage.toFixed(2)} znamená bezzkouškovou větev.` };
  }

  return { examRequired: true, label: `Průměr ${numericAverage.toFixed(2)} znamená povinnou přijímací zkoušku.` };
}

function buildDerivedEvents(app) {
  const events = app.fixedRules.actionItems.map((event) => ({ ...event }));

  if (app.id === "vse-fm-management-k") {
    const examEvent = events.find((event) => event.id === "vse-exam");
    if (examEvent) {
      const preferredDate = app.liveState.preferredExamDate ?? "2026-06-12";
      const confirmedDate = app.liveState.exactExamDate;
      examEvent.date = confirmedDate ?? preferredDate;
      examEvent.label = confirmedDate ? "Přijímací zkouška - potvrzený termín" : "Přijímací zkouška - preferovaný termín";
      examEvent.note = confirmedDate
        ? `Potvrzený slot máš nastavený na ${formatDate(confirmedDate)}.`
        : `Pracovní preference je ${formatDate(preferredDate)}, ale finální slot ještě čeká na potvrzení v InSIS / pozvánce.`;
    }
  }

  if (app.id.startsWith("czu-") && app.liveState.exactExamDate) {
    events.push({
      id: `${app.id}-results`,
      label: "Předpokládané zveřejnění výsledků testu",
      date: addBusinessDays(parseDate(app.liveState.exactExamDate), 2).toISOString().slice(0, 10),
      kind: "decision",
      actor: "Škola",
      reminderProfile: "watch",
      note: "PEF zveřejňuje výsledky po dvou pracovních dnech od konání zkoušky.",
      sourceIds: ["czu-rules"],
    });
  }

  if (app.id.startsWith("uhk-") && app.liveState.exactExamDate) {
    events.push({
      id: `${app.id}-decision-window`,
      label: "Nejpozdější vydání rozhodnutí",
      date: addDays(parseDate(app.liveState.exactExamDate), 10).toISOString().slice(0, 10),
      kind: "decision",
      actor: "Škola",
      reminderProfile: "watch",
      note: "FIM uvádí rozhodnutí do 10 dnů od konání přijímací zkoušky.",
      sourceIds: ["uhk-rules"],
    });
  }

  if (app.id === "tul-mpp-k") {
    const tulState = buildTulCondition(app);
    if (tulState?.examRequired === true) {
      events.push({
        id: "tul-exam",
        label: "Přijímací zkouška",
        startDate: app.liveState.exactExamDate ?? "2026-06-10",
        endDate: app.liveState.exactExamDate ? undefined : "2026-06-25",
        kind: "exam",
        actor: "Ty",
        reminderProfile: "prep",
        taskKey: "taskState.examCompleted",
        note: app.liveState.exactExamDate
          ? "Přesný termín je vyplněný v configu."
          : "Přesné datum doplníš po pozvánce. Pokud průměr spadne na 2.50 nebo níž, tuhle větev vypni.",
        sourceIds: ["tul-rules"],
      });
    } else if (tulState?.examRequired === false) {
      events.push({
        id: "tul-no-exam",
        label: "Bez přijímačky díky průměru",
        date: "2026-06-04",
        kind: "conditional",
        actor: "Škola",
        reminderProfile: "watch",
        note: "Po nahrání průměru a výpisu by TUL měla jet bez testu.",
        sourceIds: ["tul-rules"],
      });
    }
  }

  if (app.liveState.decision === "rejected" && app.liveState.decisionDate) {
    if (app.id === "tul-mpp-k") {
      events.push({
        id: "tul-appeal",
        label: "Konec odvolací lhůty",
        date: addDays(parseDate(app.liveState.decisionDate), 15).toISOString().slice(0, 10),
        kind: "appeal",
        actor: "Ty",
        reminderProfile: "hard",
        note: "TUL dává 15 dnů od doručení rozhodnutí.",
        sourceIds: ["tul-rules"],
      });
    }

    if (app.id === "vse-fm-management-k") {
      events.push({
        id: "vse-appeal",
        label: "Odvolání pro dodatečné přijetí",
        date: addDays(parseDate(app.liveState.decisionDate), 15).toISOString().slice(0, 10),
        kind: "appeal",
        actor: "Ty",
        reminderProfile: "hard",
        note: "Odvolání má smysl hlavně jako keep-alive na případ uvolněných míst.",
        sourceIds: ["vse-rules"],
      });
    }
  }

  if (app.id.startsWith("uhk-") && app.liveState.decisionDate) {
    events.push({
      id: `${app.id}-review-window`,
      label: "Okno na nahlédnutí do materiálů",
      date: app.liveState.decisionDate,
      endDate: addDays(parseDate(app.liveState.decisionDate), 3).toISOString().slice(0, 10),
      kind: "review",
      actor: "Ty",
      reminderProfile: "hard",
      note: "FIM uvádí dohodu se studijním oddělením po dobu 3 dnů od zveřejnění výsledků.",
      sourceIds: ["uhk-rules"],
    });
  }

  return events;
}

function buildApplicationView(app, bachelorEvents, today) {
  const derivedEvents = buildDerivedEvents(app).map((event) => ({
    ...event,
    status: eventStatus(event, app, today),
  }));
  const conflicts = derivedEvents
    .map((event) => ({ event, overlaps: getConflictBadges(event, bachelorEvents) }))
    .filter((entry) => entry.overlaps.length > 0);

  return {
    ...app,
    decision: decisionBadge(app.liveState.decision),
    derivedEvents,
    conflicts,
    fekCalculation: buildFekCalculation(app),
    tulCondition: buildTulCondition(app),
  };
}

function buildManualTasks(applications, today) {
  const tasks = [];
  const fekApp = applications.find((app) => app.id === "zcu-fek-pem-k");
  const tulApp = applications.find((app) => app.id === "tul-mpp-k");
  const vseApp = applications.find((app) => app.id === "vse-fm-management-k");

  if (fekApp?.liveState.weightedAverage == null || tulApp?.liveState.weightedAverage == null) {
    tasks.push({
      id: "manual-average",
      title: "Doplň weightedAverage pro FEK a TUL",
      tone: "warning",
      dueLabel: "Bez termínu, ale ideálně hned",
      body: "Jakmile vyplníš weightedAverage, tracker začne počítat FEK body a rozhodne, jestli TUL znamená test nebo bezzkouškovou větev.",
      chips: ["Ruční config", "FEK kalkulačka", "TUL podmínka"],
    });
  }

  if (vseApp?.liveState.preferredExamDate && !vseApp.liveState.exactExamDate) {
    tasks.push({
      id: "manual-vse-exam-confirmation",
      title: "U VŠE potvrď finální termín přijímačky",
      tone: "accent",
      dueLabel: `Preference: ${formatDate(vseApp.liveState.preferredExamDate)}`,
      body: "Tracker drží pracovní preferenci 12. 6. 2026. Jakmile VŠE v InSIS nebo v pozvánce ukáže skutečný slot, doplň ho do exactExamDate.",
      chips: ["VŠE", "InSIS", "exactExamDate"],
    });
  }

  if (fekApp?.liveState.extras?.fieldBonusEligible == null) {
    tasks.push({
      id: "manual-fek-bonus",
      title: "U FEK nastav, jestli máš nárok na B = 10",
      tone: "warning",
      dueLabel: "Bez termínu, ale před 31. 5. 2026",
      body: "V configu přepni fieldBonusEligible podle toho, jestli tvůj bakalářský program spadá do ekonomických oborů. Bez toho je FEK scénář neúplný.",
      chips: ["Ruční config", "FEK CB"],
    });
  }

  applications
    .filter((app) => app.id.startsWith("uhk-"))
    .forEach((app) => {
      const reminderDate = parseDate("2026-04-30");
      if (!app.liveState.exactExamDate && dayDiff(reminderDate, today) <= 21) {
        tasks.push({
          id: `${app.id}-harmonogram`,
          title: `Za chvíli zkontroluj harmonogram UHK pro ${app.identity.program}`,
          tone: dayDiff(reminderDate, today) < 0 ? "danger" : "warning",
          dueLabel: `Kontrolní bod: ${formatDate("2026-04-30")}`,
          body: "FIM zveřejňuje konkrétní termíny po konci dubna. Jakmile vyjdou, doplň exactExamDate.",
          chips: ["UHK", "Harmonogram"],
        });
      }
    });

  return tasks;
}

function buildReminderTasks(applications, today) {
  const tasks = [];
  const profiles = admissionsConfig.meta.reminderProfiles;

  applications.forEach((app) => {
    app.derivedEvents.forEach((event) => {
      if (event.actor !== "Ty" || event.status === "done") return;

      const dueDate = parseDate(event.date ?? event.startDate);
      if (!dueDate) return;

      const offsets = profiles[event.reminderProfile ?? "hard"] ?? profiles.hard;
      const daysLeft = dayDiff(dueDate, today);
      if (daysLeft < 0 || offsets.includes(daysLeft)) {
        tasks.push({
          id: `${app.id}-${event.id}-reminder`,
          title: `${app.identity.shortLabel}: ${event.label}`,
          tone: daysLeft < 0 ? "danger" : daysLeft <= 3 ? "warning" : "accent",
          dueLabel: daysLeft < 0 ? `${Math.abs(daysLeft)} dní po termínu` : `za ${daysLeft} dní · ${formatRange(event.date ?? event.startDate, event.endDate)}`,
          body: event.note ?? app.fixedRules.acceptanceLook,
          chips: [app.identity.shortLabel, event.kind],
        });
      }
    });
  });

  return tasks;
}

function buildRecommendations(applications) {
  const accepted = applications
    .filter((app) => app.liveState.decision === "accepted")
    .sort((a, b) => a.priorities.finalChoiceRank - b.priorities.finalChoiceRank);

  const recommendations = [];
  const acceptedIds = new Set(accepted.map((app) => app.id));
  const acceptedBest = accepted[0];
  const vse = applications.find((app) => app.id === "vse-fm-management-k");

  if (
    acceptedIds.has("vse-fm-management-k") &&
    (!acceptedBest || acceptedBest.id === "vse-fm-management-k") &&
    !vse.liveState.taskState.returnSlipSent
  ) {
    recommendations.push({
      title: "VŠE drž jako keep-alive",
      body: "Pokud je VŠE přijatá a lepší škola ještě není jistá, pošli Návratku. Není to finální preference, ale chrání tě před prázdnou rukou.",
      tags: ["VŠE", "Návratka", "keep-alive"],
    });
  }

  if (acceptedIds.has("czu-eamn-k") && acceptedIds.has("czu-paan-k")) {
    recommendations.push({
      title: "Při dvojím přijetí na ČZU ber EAMN-k",
      body: "Obě varianty jsou z téže fakulty, ale podle finální priority vítězí EAMN-k. PAAN-k dává smysl jen jako záložní držák, dokud EAMN není jisté.",
      tags: ["ČZU", "EAMN", "PAAN"],
    });
  }

  if (!accepted.length) {
    recommendations.push({
      title: "Zatím jde hlavně o zachování opcí",
      body: "Dokud nejsou výsledky venku, nejdůležitější je nepropásnout dokumentové a potvrzovací termíny. VŠE Návratka je první velký keep-alive checkpoint.",
      tags: ["pre-decision", "keep-alive"],
    });
  }

  recommendations.push({
    title: "FEK / ČZU / pozdější TUL-UHK zápisy ber jako tvrdé commit momenty",
    body: "Potvrzení typu VŠE Návratka ještě může být čistě ochranný tah. Osobní nebo závazné zápisy už ber jako moment, kdy se musíš přepnout z držení opcí do finální volby.",
    tags: ["commitment", "zápis"],
  });

  recommendations.push({
    title: "Odmítnutí neznamená vždy konec",
    body: "VŠE může z odvolání dělat dodatečné přijetí, TUL má 15denní odvolání a UHK dává prostor na nahlédnutí a přezkoumání. Naopak u FEK tu odvolací větev z podkladů neinferuju.",
    tags: ["odvolání", "přezkum"],
  });

  return recommendations;
}

function buildMasterTimeline(applications, bachelorTimeline) {
  const bachelorEvents = bachelorTimeline.events.map((event) => ({
    ...event,
    sourceIds: bachelorTimeline.sourceIds,
    timelineSchool: bachelorTimeline.school,
  }));

  const applicationEvents = applications.flatMap((app) =>
    app.derivedEvents.map((event) => ({
      ...event,
      timelineSchool: app.identity.shortLabel,
      finalChoiceRank: app.priorities.finalChoiceRank,
    })),
  );

  return [...bachelorEvents, ...applicationEvents].sort((a, b) => {
    const aDate = parseDate(a.date ?? a.startDate);
    const bDate = parseDate(b.date ?? b.startDate);
    return aDate - bDate;
  });
}

function renderHeroSummary(applications, today) {
  const submitted = applications.filter((app) => app.liveState.submitted).length;
  const paid = applications.filter((app) => app.liveState.paid).length;
  const accepted = applications.filter((app) => app.liveState.decision === "accepted").length;
  const nextHardDate = applications
    .flatMap((app) => app.derivedEvents)
    .filter((event) => event.actor === "Ty" && event.status !== "done")
    .map((event) => parseDate(event.date ?? event.startDate))
    .filter(Boolean)
    .sort((a, b) => a - b)[0];

  return `
    <div class="summary-card">
      <span class="summary-card__value">${submitted}/7</span>
      <span class="summary-card__label">přihlášek je označených jako podaných</span>
    </div>
    <div class="summary-card">
      <span class="summary-card__value">${paid}/7</span>
      <span class="summary-card__label">přihlášek je označených jako zaplacených</span>
    </div>
    <div class="summary-card">
      <span class="summary-card__value">${accepted}</span>
      <span class="summary-card__label">aktuálně přijatých variant</span>
    </div>
    <div class="summary-card">
      <span class="summary-card__value">${nextHardDate ? formatDate(nextHardDate) : "čeká se"}</span>
      <span class="summary-card__label">nejbližší známý aktivní termín</span>
    </div>
    <div class="summary-card">
      <span class="summary-card__value">${formatDate(today)}</span>
      <span class="summary-card__label">referenční datum trackeru</span>
    </div>
  `;
}

function renderActions(applications, today) {
  const items = [...buildManualTasks(applications, today), ...buildReminderTasks(applications, today)].slice(0, 9);
  if (!items.length) {
    return `<div class="empty-state">Teď není nic akutního. Jakmile doplníš další live data v <span class="mono">${escapeHtml(admissionsConfig.meta.configPath)}</span>, tracker sem přidá nové akce.</div>`;
  }

  return `
    <div class="action-list">
      ${items
        .map(
          (item) => `
            <article class="action-card action-card--${escapeHtml(item.tone)}">
              <div class="action-card__top">
                <h3 class="action-card__title">${escapeHtml(item.title)}</h3>
                <span class="badge badge--${escapeHtml(item.tone)}">${escapeHtml(item.dueLabel)}</span>
              </div>
              <p class="muted">${escapeHtml(item.body)}</p>
              <div class="chip-row">
                ${item.chips.map((chip) => `<span class="chip">${escapeHtml(chip)}</span>`).join("")}
              </div>
            </article>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderTimeline(timeline, bachelorEvents) {
  return `
    <div class="callout">
      <strong>Tvrdé kolize, které tracker hlídá:</strong>
      FEK doklady <strong>31. 5. 2026</strong> a TUL doklady <strong>4. 6. 2026</strong>
      padají přímo do NU <strong>Bc SZZ 25. 5. - 5. 6. 2026</strong>.
      VŠE Návratka <strong>25. 6. 2026</strong> je zase dřív, než budou definitivně uzavřené všechny ČZU / UHK scénáře.
    </div>
    <div class="timeline-list">
      ${timeline
        .map((event) => {
          const conflictBadges = event.timelineSchool !== admissionsConfig.bachelorTimeline.school ? getConflictBadges(event, bachelorEvents) : [];
          const classes = [
            "timeline-row",
            conflictBadges.length ? "timeline-row--conflict" : "",
            event.critical ? "timeline-row--critical" : "",
          ]
            .filter(Boolean)
            .join(" ");

          return `
            <article class="${classes}">
              <div class="timeline-row__grid">
                <div>
                  <div class="timeline-date">${escapeHtml(formatRange(event.date ?? event.startDate, event.endDate))}</div>
                  <div class="timeline-meta">${escapeHtml(event.timelineSchool ?? "")}</div>
                </div>
                <div class="badge-row">
                  <span class="badge badge--${event.actor === "Ty" ? "accent" : "neutral"}">${escapeHtml(event.actor)}</span>
                  <span class="badge badge--neutral">${escapeHtml(event.kind)}</span>
                </div>
                <div>
                  <strong>${escapeHtml(event.label)}</strong>
                  ${event.note ? `<div class="timeline-meta">${escapeHtml(event.note)}</div>` : ""}
                </div>
                <div class="chip-row">
                  ${conflictBadges.map((conflict) => `<span class="chip">Kolize: ${escapeHtml(conflict.label)}</span>`).join("")}
                </div>
              </div>
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderSchoolCard(app) {
  const factCards = [
    { label: "Finální priorita", value: `#${app.priorities.finalChoiceRank}` },
    { label: "Keep-alive priorita", value: `#${app.priorities.keepAliveRank}` },
    { label: "Forma", value: app.identity.form },
    { label: "Kapacita", value: app.fixedRules.capacity },
  ];

  const statusRows = [
    { label: "Přihláška", value: app.liveState.submitted ? "podaná" : "chybí" },
    { label: "Poplatek", value: app.liveState.paid ? "zaplacený" : "nepotvrzený" },
    ...(app.liveState.preferredExamDate
      ? [{ label: "Preferovaný termín zkoušky", value: formatDate(app.liveState.preferredExamDate) }]
      : []),
    ...(app.liveState.preferredExamDate || app.liveState.exactExamDate
      ? [{ label: "Potvrzený termín zkoušky", value: app.liveState.exactExamDate ? formatDate(app.liveState.exactExamDate) : "čeká se" }]
      : []),
    { label: "Rozhodnutí", value: app.decision.label },
    { label: "Datum rozhodnutí", value: app.liveState.decisionDate ? formatDate(app.liveState.decisionDate) : "zatím nic" },
    { label: "Diplom připravený", value: app.liveState.diplomaReady ? "ano" : "ne / neznámo" },
    { label: "Zapsáno", value: app.liveState.enrolled ? "ano" : "ne" },
  ];

  const computedBlocks = [];

  if (app.fekCalculation) {
    computedBlocks.push(
      app.fekCalculation.ready
        ? `
          <div class="school-section">
            <h4>FEK kalkulačka</h4>
            <p>${escapeHtml(app.fekCalculation.label)}. Aktuálně by tracker spočítal <strong>${escapeHtml(app.fekCalculation.total)}</strong> bodu.</p>
            <div class="chip-row">
              <span class="chip">P ${escapeHtml(app.fekCalculation.breakdown.p)}</span>
              <span class="chip">B ${escapeHtml(app.fekCalculation.breakdown.b)}</span>
              <span class="chip">KP ${escapeHtml(app.fekCalculation.breakdown.kp)}</span>
              <span class="chip">ZS ${escapeHtml(app.fekCalculation.breakdown.zs)}</span>
            </div>
          </div>
        `
        : `
          <div class="school-section">
            <h4>FEK kalkulačka</h4>
            <p>${escapeHtml(app.fekCalculation.headline)}</p>
          </div>
        `,
    );
  }

  if (app.tulCondition) {
    computedBlocks.push(`
      <div class="school-section">
        <h4>TUL podmínka testu</h4>
        <p>${escapeHtml(app.tulCondition.label)}</p>
      </div>
    `);
  }

  return `
    <article class="school-card">
      <div class="school-card__top">
        <div class="school-card__identity">
          <h3>${escapeHtml(app.identity.shortLabel)}</h3>
          <div class="school-card__meta">${escapeHtml(app.identity.school)} · ${escapeHtml(app.identity.faculty)} · ${escapeHtml(app.identity.campus)}</div>
          <div class="school-card__meta">${escapeHtml(app.identity.program)} · ${escapeHtml(app.identity.code)} · ${escapeHtml(app.identity.form)}</div>
        </div>
        <div class="badge-row">
          <span class="badge badge--${escapeHtml(app.decision.tone)}">${escapeHtml(app.decision.label)}</span>
          <span class="badge badge--neutral">final #${app.priorities.finalChoiceRank}</span>
          <span class="badge badge--neutral">keep #${app.priorities.keepAliveRank}</span>
        </div>
      </div>

      <p class="school-card__note">${escapeHtml(app.identity.travelPrestigeNote)}</p>

      <div class="fact-grid">
        ${factCards
          .map(
            (fact) => `
              <div class="fact-card">
                <span class="fact-card__label">${escapeHtml(fact.label)}</span>
                <span class="fact-card__value">${escapeHtml(fact.value)}</span>
              </div>
            `,
          )
          .join("")}
      </div>

      <div class="school-section">
        <h4>Jak vypadá přijetí</h4>
        <p>${escapeHtml(app.fixedRules.acceptanceLook)}</p>
      </div>

      <div class="school-section">
        <h4>Přijímačky / hodnocení</h4>
        <p>${escapeHtml(app.fixedRules.scoring.summary)}</p>
        <ul class="tight-list">
          ${app.fixedRules.exam.subjects.map((subject) => `<li>${escapeHtml(subject)}</li>`).join("")}
        </ul>
      </div>

      <div class="school-section">
        <h4>Akční body</h4>
        <div class="school-actions">
          ${app.derivedEvents
            .map((event) => {
              const statusClass =
                event.status === "done" ? "school-action--done" : event.status === "conditional" ? "school-action--conditional" : "school-action--pending";
              const statusLabel =
                event.status === "done" ? "splněno" : event.status === "overdue" ? "po termínu" : event.status === "conditional" ? "podmíněně" : "čeká";

              return `
                <div class="school-action ${statusClass}">
                  <div class="school-action__head">
                    <strong>${escapeHtml(event.label)}</strong>
                    <span class="badge badge--neutral">${escapeHtml(statusLabel)}</span>
                  </div>
                  <div class="timeline-meta">${escapeHtml(formatRange(event.date ?? event.startDate, event.endDate))} · ${escapeHtml(event.actor)} · ${escapeHtml(event.kind)}</div>
                  ${event.note ? `<div class="timeline-meta">${escapeHtml(event.note)}</div>` : ""}
                </div>
              `;
            })
            .join("")}
        </div>
      </div>

      ${computedBlocks.join("")}

      <div class="school-section">
        <h4>Odvolání / přezkum</h4>
        <p>${escapeHtml(app.fixedRules.appealReview.summary)}</p>
      </div>

      ${
        app.conflicts.length
          ? `
            <div class="school-section">
              <h4>Kolize s NU</h4>
              <ul class="tight-list">
                ${app.conflicts
                  .map(
                    (conflict) => `
                      <li>${escapeHtml(conflict.event.label)} se překrývá s ${escapeHtml(conflict.overlaps.map((item) => item.label).join(", "))}.</li>
                    `,
                  )
                  .join("")}
              </ul>
            </div>
          `
          : ""
      }

      <div class="school-section">
        <h4>Live stav</h4>
        <div class="status-grid">
          ${statusRows
            .map(
              (row) => `
                <div class="status-row">
                  <div>${escapeHtml(row.label)}</div>
                  <strong>${escapeHtml(row.value)}</strong>
                </div>
              `,
            )
            .join("")}
        </div>
      </div>

      <div class="chip-row">
        ${sourceChips(app.fixedRules.sourceIds)}
      </div>
    </article>
  `;
}

function renderFlow(applications) {
  return `
    <div class="callout">
      <strong>Jak s flow pracovat:</strong>
      tracker rozlišuje mezi <strong>keep-alive kroky</strong> (např. VŠE Návratka) a
      <strong>tvrdými commit momenty</strong> (zápisy a osobní administrace zápisu).
      To je hlavní pojistka proti tomu, aby ses upsal moc brzo a pak litoval lepší pozdější nabídky.
    </div>
    <div class="flow-list">
      ${buildRecommendations(applications)
        .map(
          (recommendation, index) => `
            <article class="flow-card flow-card--active">
              <div class="flow-card__top">
                <h3>${index + 1}. ${escapeHtml(recommendation.title)}</h3>
                <span class="flow-card__arrow">${index < 3 ? "→" : "✓"}</span>
              </div>
              <p class="muted">${escapeHtml(recommendation.body)}</p>
              <div class="chip-row">
                ${recommendation.tags.map((tag) => `<span class="chip">${escapeHtml(tag)}</span>`).join("")}
              </div>
            </article>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderSources() {
  return `
    <div class="callout">
      <strong>Jak tracker cituje:</strong>
      každá škola má v kartě vlastní source chips. Tady je centrální seznam všech podkladů, které tento tracker používá.
    </div>
    <div class="source-list">
      ${sourceLibrary
        .map(
          (source) => `
            <article class="source-card">
              <div class="source-card__top">
                <div>
                  <h3>${escapeHtml(source.title)}</h3>
                  <div class="source-card__kind">${escapeHtml(source.kind)}</div>
                </div>
                <a class="badge badge--accent" href="${escapeHtml(encodeLink(source.url))}" target="_blank" rel="noreferrer">
                  Otevřít
                </a>
              </div>
              <p class="muted">${escapeHtml(source.note)}</p>
            </article>
          `,
        )
        .join("")}
    </div>
  `;
}

function bootstrap() {
  const today = getToday(admissionsConfig);
  const bachelorCriticalEvents = admissionsConfig.bachelorTimeline.events.filter((event) => event.critical);
  const applications = admissionsConfig.applications
    .map((application) => buildApplicationView(application, bachelorCriticalEvents, today))
    .sort((a, b) => a.priorities.finalChoiceRank - b.priorities.finalChoiceRank);
  const timeline = buildMasterTimeline(applications, admissionsConfig.bachelorTimeline);

  document.getElementById("hero-summary").innerHTML = renderHeroSummary(applications, today);
  document.getElementById("next-actions-content").innerHTML = renderActions(applications, today);
  document.getElementById("timeline-content").innerHTML = renderTimeline(timeline, bachelorCriticalEvents);
  document.getElementById("schools-content").innerHTML = applications.map(renderSchoolCard).join("");
  document.getElementById("flow-content").innerHTML = renderFlow(applications);
  document.getElementById("sources-content").innerHTML = renderSources();
}

if (typeof document !== "undefined") {
  window.addEventListener("DOMContentLoaded", bootstrap);
}

export { bootstrap };
