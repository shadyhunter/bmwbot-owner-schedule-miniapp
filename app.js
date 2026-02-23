(function () {
  "use strict";

  const SLOT_MINUTES = 15;
  const SLOTS_PER_DAY = 24 * 60 / SLOT_MINUTES;
  const TIMELINE_VISIBLE_START_HOUR = 6;
  const TIMELINE_VISIBLE_START_SLOT = (TIMELINE_VISIBLE_START_HOUR * 60) / SLOT_MINUTES;
  const TIMELINE_VISIBLE_SLOT_COUNT = SLOTS_PER_DAY - TIMELINE_VISIBLE_START_SLOT;
  const LOCAL_STORAGE_PREFIX = "bmwbot_kolyan_schedule_v1";
  const DEFAULT_TIMEZONE = "Europe/Moscow";

  const ZONES = {
    OPEN_NOTICE: {
      label: "Открыт (с предупреждением)",
      className: "zone-open-notice",
      note: "Можно подтверждать автоматически, если клиент предупредил заранее",
    },
    OPEN_APPROVAL: {
      label: "Только по согласованию",
      className: "zone-open-approval",
      note: "Нужно спросить Коляна перед подтверждением",
    },
    CLOSED: {
      label: "Закрыт",
      className: "zone-closed",
      note: "Не подтверждаем визит, предлагаем другое время",
    },
  };

  const state = {
    activeTab: "tune",
    tuneScope: "weekdays",
    tuneAdvancedOpen: false,
    calendarOpen: false,
    mode: "override",
    date: todayISO(),
    weekday: String(new Date().getDay()),
    defaultNoticeMinutesGreen: 90,
    defaultNoticeMinutesBlue: 0,
    timezone: DEFAULT_TIMEZONE,
    version: null,
    source: "local",
    segments: demoSegments({ green: 90, blue: 0 }),
    tuneBoundaries: [minsToSlot(9 * 60), minsToSlot(10 * 60), minsToSlot(18 * 60), minsToSlot(19 * 60)],
    dayOff: false,
    scheduleLoading: false,
    owner: null,
    lastLoadedFrom: "local",
    lastSchedulePayload: null,
    lastSaveMarker: null,
  };

  const els = {
    tabButtons: Array.from(document.querySelectorAll("[data-tab-btn]")),
    tabPanels: Array.from(document.querySelectorAll("[data-tab-panel]")),
    ownerIdentity: byId("ownerIdentity"),
    storageModeBadge: byId("storageModeBadge"),
    scheduleVersion: byId("scheduleVersion"),
    timezoneValue: byId("timezoneValue"),
    btnTuneWeekdays: byId("btnTuneWeekdays"),
    btnTuneWeekends: byId("btnTuneWeekends"),
    btnTuneSpecific: byId("btnTuneSpecific"),
    btnToggleTuneAdvanced: byId("btnToggleTuneAdvanced"),
    btnTuneAdvancedClose: byId("btnTuneAdvancedClose"),
    btnSaveSimple: byId("btnSaveSimple"),
    simpleGreenNoticeInput: byIdOptional("simpleGreenNoticeInput"),
    tuneScopeHint: byId("tuneScopeHint"),
    tuneCalendarPanel: byId("tuneCalendarPanel"),
    tuneCalendarList: byId("tuneCalendarList"),
    tuneCalendarMeta: byId("tuneCalendarMeta"),
    tuneAdvancedPanel: byId("tuneAdvancedPanel"),
    modeSelect: byId("modeSelect"),
    dateInput: byId("dateInput"),
    weekdaySelect: byId("weekdaySelect"),
    dateFieldWrap: byId("dateFieldWrap"),
    weekdayFieldWrap: byId("weekdayFieldWrap"),
    btnOpenSettings: byId("btnOpenSettings"),
    btnOpenAdvancedMini: byId("btnOpenAdvancedMini"),
    btnRevertUnsaved: byId("btnRevertUnsaved"),
    btnResetPreviewDefault: byId("btnResetPreviewDefault"),
    defaultNoticeInput: byId("defaultNoticeInput"),
    defaultBlueNoticeInput: byIdOptional("defaultBlueNoticeInput"),
    settingsModal: byId("settingsModal"),
    btnCloseSettings: byId("btnCloseSettings"),
    btnCancelSettings: byId("btnCancelSettings"),
    btnApplySettings: byId("btnApplySettings"),
    btnToday: byId("btnToday"),
    btnTomorrow: byId("btnTomorrow"),
    btnCopyPrev: byId("btnCopyPrev"),
    btnNormalize: byId("btnNormalize"),
    btnAddSegment: byId("btnAddSegment"),
    btnSave: byId("btnSave"),
    tuneTimelineTitle: byId("tuneTimelineTitle"),
    timelineDayModeToggle: byId("timelineDayModeToggle"),
    btnDayModeWork: byId("btnDayModeWork"),
    btnDayModeOff: byId("btnDayModeOff"),
    hourAxis: byId("hourAxis"),
    timelineGridWrap: byId("timelineGridWrap"),
    timelineGrid: byId("timelineGrid"),
    timelineBoundaryOverlay: byId("timelineBoundaryOverlay"),
    boundary1Range: byId("boundary1Range"),
    boundary2Range: byId("boundary2Range"),
    boundary3Range: byId("boundary3Range"),
    boundary4Range: byId("boundary4Range"),
    boundarySummary: byId("boundarySummary"),
    segmentsList: byId("segmentsList"),
    payloadPreview: byId("payloadPreview"),
    eventLog: byId("eventLog"),
    segmentRowTemplate: byId("segmentRowTemplate"),
    todayArrivalsMeta: byId("todayArrivalsMeta"),
    todayArrivalsList: byId("todayArrivalsList"),
    todayPartsMeta: byId("todayPartsMeta"),
    todayPartsList: byId("todayPartsList"),
    todaySummaryMeta: byId("todaySummaryMeta"),
    todaySummaryKpis: byId("todaySummaryKpis"),
    todayOpenWindowsList: byId("todayOpenWindowsList"),
    todaySummaryNotes: byId("todaySummaryNotes"),
  };

  const telegram = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
  let tuneDrag = null;
  let saveFxTimer = null;
  let revertFxTimer = null;
  let scheduleLoadRequestSeq = 0;

  init();

  function init() {
    initTelegram();
    bindTabNavigation();
    bindControls();
    renderHourAxis();
    hydrateControlsFromState();
    setTuneScope("weekdays", { skipLoad: true, keepAdvancedState: true });
    renderAll();
    void loadSchedule();
  }

  function initTelegram() {
    if (!telegram) {
      els.ownerIdentity.textContent = "Browser mode (без Telegram). Можно тестировать локально.";
      logEvent("Telegram WebApp API не найден, работаем в browser mode.");
      return;
    }

    try {
      telegram.ready();
      telegram.expand();
      if (telegram.disableVerticalSwipes) {
        telegram.disableVerticalSwipes();
      }
    } catch (err) {
      logEvent("Ошибка Telegram init: " + safeErr(err));
    }

    const user = telegram.initDataUnsafe && telegram.initDataUnsafe.user ? telegram.initDataUnsafe.user : null;
    state.owner = user || null;
    const ownerLabel = user
      ? `Telegram: ${user.first_name || ""} ${user.last_name || ""} (@${user.username || "no_username"}, id=${user.id})`.trim()
      : "Telegram user не определен";
    els.ownerIdentity.textContent = ownerLabel;

    try {
      if (telegram.MainButton) {
        telegram.MainButton.setText("Сохранить расписание");
        telegram.MainButton.onClick(saveSchedule);
        telegram.MainButton.show();
      }
    } catch (err) {
      logEvent("Не удалось активировать MainButton: " + safeErr(err));
    }
  }

  function bindControls() {
    els.btnTuneWeekdays.addEventListener("click", async () => {
      await setTuneScope("weekdays");
    });

    els.btnTuneWeekends.addEventListener("click", async () => {
      await setTuneScope("weekends");
    });

    els.btnTuneSpecific.addEventListener("click", async () => {
      await setTuneScope("specific");
    });

    els.btnToggleTuneAdvanced.addEventListener("click", () => {
      state.calendarOpen = !state.calendarOpen;
      renderAll();
    });

    els.btnOpenAdvancedMini.addEventListener("click", () => {
      if (state.tuneScope !== "specific") return;
      state.tuneAdvancedOpen = !state.tuneAdvancedOpen;
      renderAll();
    });

    if (els.btnRevertUnsaved) {
      els.btnRevertUnsaved.addEventListener("click", async () => {
        await revertUnsavedTuneChanges();
      });
    }

    if (els.btnResetPreviewDefault) {
      els.btnResetPreviewDefault.addEventListener("click", () => {
        resetTunePreviewToDefault();
      });
    }

    els.btnTuneAdvancedClose.addEventListener("click", () => {
      state.tuneAdvancedOpen = false;
      renderAll();
    });

    els.btnDayModeWork.addEventListener("click", () => {
      if (state.tuneScope !== "specific") return;
      if (!state.dayOff) return;
      state.dayOff = false;
      logEvent("Режим дня: рабочий.");
      renderAll();
    });

    els.btnDayModeOff.addEventListener("click", () => {
      if (state.tuneScope !== "specific") return;
      if (state.dayOff) return;
      state.dayOff = true;
      logEvent("Режим дня: выходной (override).");
      renderAll();
    });

    if (els.simpleGreenNoticeInput) {
      els.simpleGreenNoticeInput.addEventListener("change", () => {
        state.defaultNoticeMinutesGreen = clampInt(Number(els.simpleGreenNoticeInput.value), 0, 24 * 60, state.defaultNoticeMinutesGreen);
        state.defaultNoticeMinutesBlue = 0;
        applyGlobalZoneNoticesToSegments();
        logEvent("Обновлено N для зелёной зоны.");
        renderAll();
      });
    }

    [els.boundary1Range, els.boundary2Range, els.boundary3Range, els.boundary4Range].forEach((input, idx) => {
      input.addEventListener("input", () => {
        setTuneBoundary(idx, TIMELINE_VISIBLE_START_SLOT + Number(input.value));
      });
    });

    els.timelineBoundaryOverlay.addEventListener("pointerdown", handleTimelineBoundaryPointerDown, { capture: true });
    window.addEventListener("pointermove", handleTimelineBoundaryPointerMove, { passive: false });
    window.addEventListener("pointerup", handleTimelineBoundaryPointerUp);
    window.addEventListener("pointercancel", handleTimelineBoundaryPointerUp);

    els.modeSelect.addEventListener("change", async () => {
      state.mode = els.modeSelect.value;
      toggleModeFields();
      await loadSchedule();
    });

    els.dateInput.addEventListener("change", async () => {
      state.date = els.dateInput.value || todayISO();
      await loadSchedule();
    });

    els.weekdaySelect.addEventListener("change", async () => {
      state.weekday = els.weekdaySelect.value;
      await loadSchedule();
    });

    els.btnOpenSettings.addEventListener("click", () => {
      openSettingsModal();
    });

    els.btnCloseSettings.addEventListener("click", () => {
      closeSettingsModal();
    });

    els.btnCancelSettings.addEventListener("click", () => {
      closeSettingsModal();
    });

    els.btnApplySettings.addEventListener("click", () => {
      applyGlobalSettingsFromModal();
    });

    els.settingsModal.addEventListener("click", (event) => {
      if (event.target === els.settingsModal) {
        closeSettingsModal();
      }
    });

    els.btnToday.addEventListener("click", async () => {
      state.mode = "override";
      state.date = todayISO();
      hydrateControlsFromState();
      renderAll();
      await loadSchedule();
    });

    els.btnTomorrow.addEventListener("click", async () => {
      state.mode = "override";
      state.date = addDaysISO(todayISO(), 1);
      hydrateControlsFromState();
      renderAll();
      await loadSchedule();
    });

    els.btnCopyPrev.addEventListener("click", () => {
      copyPreviousDayLocal();
    });

    els.btnNormalize.addEventListener("click", () => {
      state.segments = canonicalizeSegments(state.segments, getZoneNoticeDefaults());
      logEvent("Сегменты нормализованы.");
      renderAll();
    });

    els.btnAddSegment.addEventListener("click", () => {
      addSegment();
    });

    els.btnSave.addEventListener("click", saveSchedule);
    els.btnSaveSimple.addEventListener("click", saveSchedule);
  }

  async function setTuneScope(scope, options) {
    const opts = options && typeof options === "object" ? options : {};
    const next = ["weekdays", "weekends", "specific"].includes(scope) ? scope : "weekdays";
    const changed = state.tuneScope !== next;
    state.tuneScope = next;

    if (next === "specific") {
      state.mode = "override";
      if (!opts.keepAdvancedState) state.tuneAdvancedOpen = false;
    } else {
      state.mode = "override";
      if (!opts.keepAdvancedState) state.tuneAdvancedOpen = false;
    }

    hydrateControlsFromState();
    renderTuneScopeControls();

    if (!opts.skipLoad && (changed || opts.forceReload)) {
      await loadSchedule();
      return;
    }
    renderAll();
  }

  function renderTuneScopeControls() {
    const defs = [
      ["weekdays", els.btnTuneWeekdays],
      ["weekends", els.btnTuneWeekends],
    ];
    defs.forEach(([scope, btn]) => {
      const active = state.tuneScope === scope;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
      btn.setAttribute("aria-pressed", active ? "true" : "false");
    });
    if (els.btnTuneSpecific) {
      els.btnTuneSpecific.setAttribute("aria-selected", state.tuneScope === "specific" ? "true" : "false");
      els.btnTuneSpecific.setAttribute("aria-pressed", state.tuneScope === "specific" ? "true" : "false");
    }

    if (state.tuneScope === "weekdays") {
      els.tuneScopeHint.textContent = "Общий шаблон для будних дней. Конкретные даты настраиваются через кнопку «Календарь».";
    } else if (state.tuneScope === "weekends") {
      els.tuneScopeHint.textContent = "Общий шаблон для выходных дней. Конкретные даты настраиваются через кнопку «Календарь».";
    } else {
      els.tuneScopeHint.textContent = `Конкретная дата: ${formatIsoDate(state.date)}. Этот шаблон не перезаписывает общие «Будни/Выходные».`;
    }

    if (els.simpleGreenNoticeInput) {
      els.simpleGreenNoticeInput.value = String(clampInt(state.defaultNoticeMinutesGreen, 0, 24 * 60, 90));
    }
    els.tuneCalendarPanel.hidden = !state.calendarOpen;
    els.tuneAdvancedPanel.hidden = !(state.tuneAdvancedOpen && state.tuneScope === "specific");
    els.btnToggleTuneAdvanced.textContent = state.calendarOpen ? "Скрыть календарь" : "Календарь";
    els.btnOpenAdvancedMini.hidden = state.tuneScope !== "specific";
    els.btnOpenAdvancedMini.classList.toggle("is-active", state.tuneAdvancedOpen && state.tuneScope === "specific");
    if (els.btnResetPreviewDefault) {
      els.btnResetPreviewDefault.hidden = true;
      els.btnResetPreviewDefault.disabled = true;
    }
    if (els.timelineDayModeToggle) {
      const showDayMode = state.tuneScope === "specific";
      els.timelineDayModeToggle.hidden = !showDayMode;
      els.btnDayModeWork.classList.toggle("is-active", showDayMode && !state.dayOff);
      els.btnDayModeOff.classList.toggle("is-active", showDayMode && !!state.dayOff);
      els.btnDayModeWork.setAttribute("aria-pressed", showDayMode && !state.dayOff ? "true" : "false");
      els.btnDayModeOff.setAttribute("aria-pressed", showDayMode && !!state.dayOff ? "true" : "false");
    }

    const lockDuringDateLoad = state.tuneScope === "specific" && state.mode === "override" && !!state.scheduleLoading;
    const guardedButtons = [
      els.btnSaveSimple,
      els.btnSave,
      els.btnRevertUnsaved,
      els.btnResetPreviewDefault,
      els.btnDayModeWork,
      els.btnDayModeOff,
    ].filter(Boolean);
    guardedButtons.forEach((btn) => {
      if (!btn) return;
      btn.classList.toggle("is-loading-locked", lockDuringDateLoad);
      if (lockDuringDateLoad) {
        btn.disabled = true;
        return;
      }
      if (!btn.classList.contains("is-saving") && !btn.classList.contains("is-reverting")) {
        btn.disabled = false;
      }
    });

    toggleModeFields();
  }

  function getSaveButtonsForFx() {
    const list = [];
    if (els.btnSaveSimple) list.push(els.btnSaveSimple);
    if (els.btnSave) list.push(els.btnSave);
    return list;
  }

  function getRevertButtonsForFx() {
    return els.btnRevertUnsaved ? [els.btnRevertUnsaved] : [];
  }

  function startSaveButtonFx() {
    if (saveFxTimer) {
      clearTimeout(saveFxTimer);
      saveFxTimer = null;
    }
    getSaveButtonsForFx().forEach((btn) => {
      if (!btn) return;
      if (!btn.dataset.baseLabel) {
        btn.dataset.baseLabel = (btn.textContent || "").trim();
      }
      btn.classList.remove("is-saved");
      btn.classList.add("is-saving");
      if (!btn.hidden) {
        btn.textContent = btn.id === "btnSave" ? "Сохраняю дату..." : "Сохраняю...";
      }
      btn.disabled = true;
    });
  }

  function finishSaveButtonFx(success) {
    getSaveButtonsForFx().forEach((btn) => {
      if (!btn) return;
      btn.classList.remove("is-saving");
      btn.disabled = false;
      if (success) {
        btn.classList.add("is-saved");
        if (!btn.hidden) {
          btn.textContent = btn.id === "btnSave" ? "Сохранено" : "Сохранено";
        }
      } else if (btn.dataset.baseLabel) {
        btn.textContent = btn.dataset.baseLabel;
      }
    });

    if (saveFxTimer) clearTimeout(saveFxTimer);
    saveFxTimer = setTimeout(() => {
      getSaveButtonsForFx().forEach((btn) => {
        if (!btn) return;
        btn.classList.remove("is-saved");
        if (btn.dataset.baseLabel) btn.textContent = btn.dataset.baseLabel;
      });
      saveFxTimer = null;
    }, success ? 1400 : 0);
  }

  function startRevertButtonFx() {
    if (revertFxTimer) {
      clearTimeout(revertFxTimer);
      revertFxTimer = null;
    }
    getRevertButtonsForFx().forEach((btn) => {
      if (!btn) return;
      if (!btn.dataset.baseLabel) {
        btn.dataset.baseLabel = (btn.textContent || "").trim();
      }
      btn.classList.remove("is-reverted");
      btn.classList.add("is-reverting");
      if (!btn.hidden) {
        btn.textContent = "Возвращаю...";
      }
      btn.disabled = true;
    });
  }

  function finishRevertButtonFx(success) {
    getRevertButtonsForFx().forEach((btn) => {
      if (!btn) return;
      btn.classList.remove("is-reverting");
      btn.disabled = false;
      if (success) {
        btn.classList.add("is-reverted");
        if (!btn.hidden) {
          btn.textContent = "Вернуто";
        }
      } else if (btn.dataset.baseLabel) {
        btn.textContent = btn.dataset.baseLabel;
      }
    });

    if (revertFxTimer) clearTimeout(revertFxTimer);
    revertFxTimer = setTimeout(() => {
      getRevertButtonsForFx().forEach((btn) => {
        if (!btn) return;
        btn.classList.remove("is-reverted");
        if (btn.dataset.baseLabel) btn.textContent = btn.dataset.baseLabel;
      });
      revertFxTimer = null;
    }, success ? 1400 : 0);
  }

  function markScheduleSaved() {
    state.lastSaveMarker = {
      at: Date.now(),
      tuneScope: state.tuneScope,
      date: state.tuneScope === "specific" ? state.date : null,
    };
  }

  function applyPostSuccessfulSaveUi() {
    if (state.tuneScope === "specific") {
      // After saving a specific date, return focus to the calendar list.
      state.tuneAdvancedOpen = false;
      state.calendarOpen = true;
    }
  }

  async function revertUnsavedTuneChanges() {
    if (state.tuneScope === "specific" && state.mode === "override" && state.scheduleLoading) {
      logEvent("Подожди: дата ещё загружается, откат временно недоступен.");
      return;
    }
    startRevertButtonFx();
    logEvent("Возврат к последней сохранённой версии (без сохранения текущих правок).");
    try {
      await loadSchedule();
      finishRevertButtonFx(true);
    } catch (err) {
      logEvent(`Не удалось вернуть сохранённую версию: ${safeErr(err)}`);
      finishRevertButtonFx(false);
    }
  }

  function resetTunePreviewToDefault() {
    if (state.tuneScope === "specific" && state.mode === "override" && state.scheduleLoading) {
      logEvent("Подожди: дата ещё загружается, сброс временно недоступен.");
      return;
    }
    // Invalidate any in-flight load so a late response cannot repaint old data after reset.
    scheduleLoadRequestSeq += 1;
    clearAllScheduleLocalCaches();

    state.tuneScope = "weekdays";
    state.mode = "override";
    state.tuneAdvancedOpen = false;
    state.calendarOpen = false;
    state.date = todayISO();
    state.weekday = String(new Date().getDay());
    state.defaultNoticeMinutesGreen = 90;
    state.defaultNoticeMinutesBlue = 0;
    state.timezone = DEFAULT_TIMEZONE;
    state.version = null;
    state.source = "local";
    state.lastLoadedFrom = "local";
    state.lastSchedulePayload = null;
    state.lastSaveMarker = null;
    state.dayOff = false;
    state.scheduleLoading = false;
    state.segments = demoSegments({ green: 90, blue: 0 });
    syncTuneBoundariesFromSegments();
    hydrateControlsFromState();

    logEvent("Сброшены все локальные таймлайны/шаблоны и выбор режима (без сохранения в n8n).");
    renderAll();
  }

  function isRecentlySavedMarkerForDate(isoDate) {
    const m = state.lastSaveMarker;
    if (!m || !m.at) return false;
    if ((Date.now() - m.at) > 3500) return false;
    return m.tuneScope === "specific" && m.date === isoDate;
  }

  function setTuneBoundary(index, value) {
    if (!Number.isFinite(value)) return;
    const arr = normalizeTuneBoundaries(state.tuneBoundaries);
    const i = clampInt(index, 0, 3, 0);
    const min = i === 0 ? 0 : arr[i - 1];
    const max = i === 3 ? SLOTS_PER_DAY : arr[i + 1];
    arr[i] = clampInt(value, min, max, arr[i]);

    for (let left = i - 1; left >= 0; left -= 1) {
      if (arr[left] > arr[left + 1]) arr[left] = arr[left + 1];
    }
    for (let right = i + 1; right < arr.length; right += 1) {
      if (arr[right] < arr[right - 1]) arr[right] = arr[right - 1];
    }

    state.tuneBoundaries = arr;
    state.segments = segmentsFromTuneBoundaries(arr);
    renderAll();
  }

  function defaultTuneBoundaries() {
    return [minsToSlot(9 * 60), minsToSlot(10 * 60), minsToSlot(18 * 60), minsToSlot(19 * 60)];
  }

  function normalizeTuneBoundaries(boundaries) {
    const arr = Array.isArray(boundaries) ? boundaries.slice(0, 4) : [];
    while (arr.length < 4) arr.push(SLOTS_PER_DAY);
    const out = arr.map((v) => clampInt(Number(v), 0, SLOTS_PER_DAY, 0));
    for (let i = 1; i < out.length; i += 1) {
      if (out[i] < out[i - 1]) out[i] = out[i - 1];
    }
    return out;
  }

  function segmentsFromTuneBoundaries(boundaries) {
    const [b1, b2, b3, b4] = normalizeTuneBoundaries(boundaries);
    return canonicalizeSegments(
      [
        { zone: "CLOSED", startSlot: 0, endSlot: b1, noticeMinutes: 0 },
        { zone: "OPEN_APPROVAL", startSlot: b1, endSlot: b2, noticeMinutes: 0 },
        { zone: "OPEN_NOTICE", startSlot: b2, endSlot: b3, noticeMinutes: getDefaultNoticeForZone("OPEN_NOTICE") ?? 0 },
        { zone: "OPEN_APPROVAL", startSlot: b3, endSlot: b4, noticeMinutes: 0 },
        { zone: "CLOSED", startSlot: b4, endSlot: SLOTS_PER_DAY, noticeMinutes: 0 },
      ],
      getZoneNoticeDefaults()
    );
  }

  function syncTuneBoundariesFromSegments() {
    const slots = expandToSlots(state.segments || [], getZoneNoticeDefaults());
    let greenStart = -1;
    for (let i = 0; i < SLOTS_PER_DAY; i += 1) {
      if (slots[i].zone === "OPEN_NOTICE") {
        greenStart = i;
        break;
      }
    }

    if (greenStart < 0) {
      let blueStart = -1;
      for (let i = 0; i < SLOTS_PER_DAY; i += 1) {
        if (slots[i].zone === "OPEN_APPROVAL") {
          blueStart = i;
          break;
        }
      }

      if (blueStart < 0) {
        // All-red day is valid: keep every editable zone collapsed to zero.
        state.tuneBoundaries = normalizeTuneBoundaries([0, 0, 0, 0]);
        state.segments = segmentsFromTuneBoundaries(state.tuneBoundaries);
        return;
      }

      let blueEnd = blueStart;
      while (blueEnd < SLOTS_PER_DAY && slots[blueEnd].zone === "OPEN_APPROVAL") {
        blueEnd += 1;
      }

      // No green zone: represent the visible blue run using the left blue segment,
      // with green and right-blue collapsed to zero-width.
      state.tuneBoundaries = normalizeTuneBoundaries([blueStart, blueEnd, blueEnd, blueEnd]);
      state.segments = segmentsFromTuneBoundaries(state.tuneBoundaries);
      return;
    }

    let greenEnd = greenStart;
    while (greenEnd < SLOTS_PER_DAY && slots[greenEnd].zone === "OPEN_NOTICE") {
      greenEnd += 1;
    }

    let b1 = greenStart;
    let b2 = greenStart;
    let b3 = greenEnd;
    let b4 = greenEnd;

    if (b2 > 0 && slots[b2 - 1].zone === "OPEN_APPROVAL") {
      let p = b2 - 1;
      while (p >= 0 && slots[p].zone === "OPEN_APPROVAL") p -= 1;
      b1 = p + 1;
    }

    if (b3 < SLOTS_PER_DAY && slots[b3].zone === "OPEN_APPROVAL") {
      let p = b3;
      while (p < SLOTS_PER_DAY && slots[p].zone === "OPEN_APPROVAL") p += 1;
      b4 = p;
    }

    state.tuneBoundaries = normalizeTuneBoundaries([b1, b2, b3, b4]);
    // Keep visible timeline colors and saved segments in lockstep with the 4 handles.
    state.segments = segmentsFromTuneBoundaries(state.tuneBoundaries);
  }

  function renderTuneBoundaries() {
    const [b1, b2, b3, b4] = normalizeTuneBoundaries(state.tuneBoundaries);
    state.tuneBoundaries = [b1, b2, b3, b4];
    const vb1 = Math.max(TIMELINE_VISIBLE_START_SLOT, b1);
    const vb2 = Math.max(TIMELINE_VISIBLE_START_SLOT, b2);
    const vb3 = Math.max(TIMELINE_VISIBLE_START_SLOT, b3);
    const vb4 = Math.max(TIMELINE_VISIBLE_START_SLOT, b4);

    [els.boundary1Range, els.boundary2Range, els.boundary3Range, els.boundary4Range].forEach((input) => {
      if (!input) return;
      input.min = "0";
      input.max = String(TIMELINE_VISIBLE_SLOT_COUNT);
    });
    els.boundary1Range.value = String(vb1 - TIMELINE_VISIBLE_START_SLOT);
    els.boundary2Range.value = String(vb2 - TIMELINE_VISIBLE_START_SLOT);
    els.boundary3Range.value = String(vb3 - TIMELINE_VISIBLE_START_SLOT);
    els.boundary4Range.value = String(vb4 - TIMELINE_VISIBLE_START_SLOT);
    if (els.boundarySummary) {
      els.boundarySummary.innerHTML = "";
    }
    return;

    const zones = [
      ["red", "Красная", 0, b1],
      ["blue", "Синяя", b1, b2],
      ["green", "Зелёная", b2, b3],
      ["blue", "Синяя", b3, b4],
      ["red", "Красная", b4, SLOTS_PER_DAY],
    ];
    els.boundarySummary.innerHTML = "";
    zones.forEach(([tone, label, start, end]) => {
      const chip = document.createElement("div");
      chip.className = `boundary-chip is-${tone}`;
      const durationMin = Math.max(0, (end - start) * SLOT_MINUTES);
      chip.textContent = `${label}: ${slotToTime(start)}-${slotToTime(end)} (${formatDuration(durationMin)})`;
      els.boundarySummary.appendChild(chip);
    });
  }

  function renderTuneCalendarPanel() {
    if (!els.tuneCalendarPanel || !els.tuneCalendarList) return;
    if (!state.calendarOpen) {
      els.tuneCalendarList.innerHTML = "";
      return;
    }

    const start = todayISO();
    const rows = [];
    for (let i = 0; i < 14; i += 1) {
      const iso = addDaysISO(start, i);
      rows.push(buildTuneCalendarRowData(iso));
    }

    els.tuneCalendarList.innerHTML = "";
    rows.forEach((row) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tune-calendar-row";
      if (row.isActive) btn.classList.add("is-active");

      const dateBox = document.createElement("div");
      dateBox.className = "tune-calendar-date";
      const dateMain = document.createElement("div");
      dateMain.className = "main";
      dateMain.textContent = row.dateLabel;
      const dateSub = document.createElement("div");
      dateSub.className = "sub";
      dateSub.textContent = row.weekdayLabel || "";
      dateBox.appendChild(dateMain);
      dateBox.appendChild(dateSub);

      const mini = document.createElement("div");
      mini.className = "tune-calendar-mini";
      const miniTrack = document.createElement("div");
      miniTrack.className = "tune-calendar-mini-track";
      miniTrack.style.background = row.gradient;
      if (row.isDayOff) miniTrack.classList.add("is-day-off");
      mini.appendChild(miniTrack);

      const tag = document.createElement("div");
      tag.className = "tune-calendar-tag";
      if (row.sourceKind === "override") tag.classList.add("is-override");
      if (row.isActive) tag.classList.add("is-active");
      if (row.isDayOff) tag.classList.add("is-day-off");
      tag.textContent = row.tag;

      btn.appendChild(dateBox);
      btn.appendChild(mini);
      btn.appendChild(tag);

      btn.addEventListener("click", () => {
        void openSpecificDateFromCalendar(row.isoDate);
      });

      els.tuneCalendarList.appendChild(btn);
    });

    if (els.tuneCalendarMeta) {
      els.tuneCalendarMeta.textContent = "Следующие 14 дней. Нажми строку, чтобы открыть редактирование конкретной даты.";
    }
  }

  async function openSpecificDateFromCalendar(isoDate) {
    if (
      state.tuneScope === "specific"
      && state.mode === "override"
      && state.date !== isoDate
      && !state.scheduleLoading
    ) {
      await autoSaveCurrentSpecificDateIfDirty("calendar-switch");
    }
    state.date = isoDate;
    state.mode = "override";
    state.tuneAdvancedOpen = false;
    state.calendarOpen = true;
    hydrateControlsFromState();
    await setTuneScope("specific", { keepAdvancedState: true, forceReload: true });
  }

  function buildTuneCalendarRowData(isoDate) {
    const isActive = state.tuneScope === "specific" && state.date === isoDate;
    const source = resolveTuneCalendarRowSource(isoDate);
    const gradient = buildMiniTimelineGradient(source.segments);
    const d = new Date(`${isoDate}T12:00:00`);
    const weekdayShort = d.toLocaleDateString("ru-RU", { weekday: "short" });
    const weekday2 = String(weekdayShort || "").replace(/\./g, "").trim().slice(0, 2).toLowerCase();
    const dateShort = d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
    let tag = source.sourceKind === "override"
      ? "дата"
      : (isWeekend ? "выходные" : "будни");
    if (source.isDayOff) tag = "выходной";
    if (isActive && !source.isDayOff) tag = "открыта";
    if (isRecentlySavedMarkerForDate(isoDate)) tag = "сохранено";
    return {
      isoDate,
      isActive,
      sourceKind: source.sourceKind,
      isDayOff: !!source.isDayOff,
      gradient,
      dayLabel: isoDate,
      dateLabel: dateShort,
      weekdayLabel: weekday2,
      tag,
    };
  }

  function resolveTuneCalendarRowSource(isoDate) {
    if (
      state.tuneScope === "specific"
      && state.date === isoDate
      && !(state.mode === "override" && state.scheduleLoading)
    ) {
      return {
        sourceKind: "override",
        segments: state.segments.slice(),
        isDayOff: !!state.dayOff,
      };
    }

    const overridePayload = loadLocal(localKeyFor("override", isoDate, null));
    const overrideSegments = previewSegmentsFromPayload(overridePayload);
    if (overrideSegments) {
      return {
        sourceKind: "override",
        segments: overrideSegments,
        isDayOff: readDayOffFromPayload(overridePayload),
      };
    }

    const d = new Date(`${isoDate}T12:00:00`);
    const weekend = d.getDay() === 0 || d.getDay() === 6;
    const groupPayload = loadLocal(groupLocalKeyFor(weekend ? "weekends" : "weekdays"));
    const groupSegments = previewSegmentsFromPayload(groupPayload);
    if (groupSegments) {
      return {
        sourceKind: weekend ? "group-weekends" : "group-weekdays",
        segments: groupSegments,
        isDayOff: false,
      };
    }

    return {
      sourceKind: "demo",
      segments: demoSegments({ green: state.defaultNoticeMinutesGreen, blue: 0 }),
      isDayOff: false,
    };
  }

  function readDayOffFromPayload(payload) {
    if (!payload || typeof payload !== "object") return false;
    const data = payload.data || payload;
    if (typeof data.day_off === "boolean") return data.day_off;
    if (typeof data.day_disabled === "boolean") return data.day_disabled;
    if (typeof data.day_status === "string") {
      return String(data.day_status).toLowerCase() === "off";
    }
    return false;
  }

  function hasExplicitDayOffField(payload) {
    if (!payload || typeof payload !== "object") return false;
    const data = payload.data || payload;
    return typeof data.day_off === "boolean"
      || typeof data.day_disabled === "boolean"
      || typeof data.day_status === "string";
  }

  function resolveDayOffForLoadedSchedule(payload) {
    if (hasExplicitDayOffField(payload)) {
      return readDayOffFromPayload(payload);
    }
    if (state.tuneScope === "specific" && state.mode === "override") {
      const localMirror = loadLocal(scheduleKey());
      if (hasExplicitDayOffField(localMirror)) {
        return readDayOffFromPayload(localMirror);
      }
    }
    return false;
  }

  function payloadData(payload) {
    if (!payload || typeof payload !== "object") return null;
    return payload.data || payload;
  }

  function payloadVersion(payload) {
    const data = payloadData(payload);
    return data && typeof data.version === "string" ? data.version : "";
  }

  function payloadSource(payload) {
    const data = payloadData(payload);
    return data && typeof data.source === "string" ? String(data.source) : "";
  }

  function extractComparableScheduleState(payload) {
    const data = payloadData(payload);
    if (!data || typeof data !== "object") return null;

    const zoneNoticeDefaults = (data.zone_notice_defaults && typeof data.zone_notice_defaults === "object")
      ? data.zone_notice_defaults
      : null;
    const greenDefault = clampInt(
      Number(
        data.default_notice_minutes_green
        ?? data.default_notice_minutes
        ?? (zoneNoticeDefaults ? zoneNoticeDefaults.OPEN_NOTICE : 0)
        ?? 0
      ),
      0,
      24 * 60,
      0
    );

    const incoming = Array.isArray(data.segments) ? data.segments : [];
    const parsed = incoming.map(toSlotSegment).filter(Boolean);
    const canonical = canonicalizeSegments(parsed, { OPEN_NOTICE: greenDefault, OPEN_APPROVAL: 0 });

    return {
      timezone: String(data.timezone || DEFAULT_TIMEZONE),
      day_off: readDayOffFromPayload(payload),
      green_notice: greenDefault,
      segments: canonical.map((seg) => ({
        zone: seg.zone,
        start_min: seg.startSlot * SLOT_MINUTES,
        end_min: seg.endSlot * SLOT_MINUTES,
        notice_minutes: (seg.zone === "OPEN_NOTICE" || seg.zone === "OPEN_APPROVAL")
          ? clampInt(Number(seg.noticeMinutes ?? 0), 0, 24 * 60, 0)
          : 0,
      })),
    };
  }

  function isCurrentSpecificDateDirty() {
    if (!(state.tuneScope === "specific" && state.mode === "override")) return false;
    const currentPayload = buildPayload();
    const baselinePayload = loadLocal(scheduleKey()) || state.lastSchedulePayload;
    if (!baselinePayload) return true;
    const currentComparable = extractComparableScheduleState(currentPayload);
    const baselineComparable = extractComparableScheduleState(baselinePayload);
    if (!currentComparable || !baselineComparable) return true;
    return JSON.stringify(currentComparable) !== JSON.stringify(baselineComparable);
  }

  async function autoSaveCurrentSpecificDateIfDirty(reason) {
    if (!(state.tuneScope === "specific" && state.mode === "override")) return false;
    if (state.scheduleLoading) return false;
    if (!isCurrentSpecificDateDirty()) return false;
    logEvent(`Автосохранение даты перед переходом (${reason || "switch"}).`);
    try {
      await saveSchedule();
      return true;
    } catch (err) {
      logEvent(`Ошибка автосохранения даты: ${safeErr(err)}`);
      return false;
    }
  }

  function shouldPreferLocalSpecificOverride(localPayload, remotePayload) {
    if (!(state.tuneScope === "specific" && state.mode === "override")) return false;
    if (!localPayload || !remotePayload) return false;

    const remoteSource = payloadSource(remotePayload).toLowerCase();
    if (remoteSource && remoteSource !== "override") {
      return true;
    }

    const localVer = payloadVersion(localPayload);
    const remoteVer = payloadVersion(remotePayload);
    if (localVer && remoteVer && localVer > remoteVer) {
      return true;
    }

    return false;
  }

  function previewSegmentsFromPayload(payload) {
    if (!payload || typeof payload !== "object") return null;
    const data = payload.data || payload;
    const incoming = Array.isArray(data.segments) ? data.segments : [];
    const parsed = incoming.map(toSlotSegment).filter(Boolean);
    if (!parsed.length) return null;
    return canonicalizeSegments(parsed, getZoneNoticeDefaults());
  }

  function buildMiniTimelineGradient(segments) {
    const list = Array.isArray(segments) ? segments : [];
    if (!list.length) {
      return "linear-gradient(90deg, var(--zone-closed) 0%, var(--zone-closed) 100%)";
    }
    const stops = [];
    list.forEach((segment) => {
      const startSlot = Math.max(TIMELINE_VISIBLE_START_SLOT, Number(segment.startSlot || 0));
      const endSlot = Math.min(SLOTS_PER_DAY, Number(segment.endSlot || 0));
      if (endSlot <= startSlot) return;
      const startPct = ((startSlot - TIMELINE_VISIBLE_START_SLOT) / TIMELINE_VISIBLE_SLOT_COUNT) * 100;
      const endPct = ((endSlot - TIMELINE_VISIBLE_START_SLOT) / TIMELINE_VISIBLE_SLOT_COUNT) * 100;
      const color = segment.zone === "OPEN_NOTICE"
        ? "var(--zone-open-notice)"
        : segment.zone === "OPEN_APPROVAL"
          ? "var(--zone-open-approval)"
          : "var(--zone-closed)";
      stops.push(`${color} ${startPct.toFixed(2)}% ${endPct.toFixed(2)}%`);
    });
    if (!stops.length) {
      return "linear-gradient(90deg, var(--zone-closed) 0%, var(--zone-closed) 100%)";
    }
    return `linear-gradient(90deg, ${stops.join(", ")})`;
  }

  function handleTimelineBoundaryPointerDown(event) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const slot = pointerClientXToTimelineSlot(event.clientX);
    if (slot == null) return;
    const boundaryIndex = findNearestTuneBoundaryIndex(slot);
    tuneDrag = { pointerId: event.pointerId, boundaryIndex };
    setTuneBoundary(boundaryIndex, slot);
    try {
      els.timelineBoundaryOverlay.setPointerCapture(event.pointerId);
    } catch {
      // no-op
    }
    event.preventDefault();
    event.stopPropagation();
  }

  function handleTimelineBoundaryPointerMove(event) {
    if (!tuneDrag || event.pointerId !== tuneDrag.pointerId) return;
    const slot = pointerClientXToTimelineSlot(event.clientX);
    if (slot == null) return;
    setTuneBoundary(tuneDrag.boundaryIndex, slot);
    event.preventDefault();
  }

  function handleTimelineBoundaryPointerUp(event) {
    if (!tuneDrag || event.pointerId !== tuneDrag.pointerId) return;
    try {
      els.timelineBoundaryOverlay.releasePointerCapture(event.pointerId);
    } catch {
      // no-op
    }
    tuneDrag = null;
  }

  function pointerClientXToTimelineSlot(clientX) {
    const rect = els.timelineGrid.getBoundingClientRect();
    if (!rect || rect.width <= 0) return null;
    const ratio = (Number(clientX) - rect.left) / rect.width;
    const clamped = Math.min(1, Math.max(0, ratio));
    return clampInt(
      TIMELINE_VISIBLE_START_SLOT + (clamped * TIMELINE_VISIBLE_SLOT_COUNT),
      TIMELINE_VISIBLE_START_SLOT,
      SLOTS_PER_DAY,
      TIMELINE_VISIBLE_START_SLOT
    );
  }

  function findNearestTuneBoundaryIndex(slot) {
    const boundaries = normalizeTuneBoundaries(state.tuneBoundaries);
    let bestDist = Infinity;
    const candidates = [];
    for (let i = 0; i < boundaries.length; i += 1) {
      const dist = Math.abs(boundaries[i] - slot);
      if (dist < bestDist) {
        bestDist = dist;
        candidates.length = 0;
        candidates.push(i);
      } else if (dist === bestDist) {
        candidates.push(i);
      }
    }
    if (candidates.length <= 1) {
      return candidates[0] ?? 0;
    }

    const base = boundaries[candidates[0]];
    const preferRight = slot >= base;
    let bestIdx = candidates[0];
    let bestRoom = -1;
    for (const i of candidates) {
      const current = boundaries[i];
      const min = i === 0 ? 0 : boundaries[i - 1];
      const max = i === boundaries.length - 1 ? SLOTS_PER_DAY : boundaries[i + 1];
      const room = preferRight ? (max - current) : (current - min);
      if (room > bestRoom) {
        bestRoom = room;
        bestIdx = i;
        continue;
      }
      if (room === bestRoom) {
        if (preferRight ? i > bestIdx : i < bestIdx) {
          bestIdx = i;
        }
      }
    }
    return bestIdx;
  }

  function isGroupTuneScope() {
    return state.tuneScope === "weekdays" || state.tuneScope === "weekends";
  }

  function tuneScopeLocalKey() {
    return `${LOCAL_STORAGE_PREFIX}:group:${state.tuneScope}`;
  }

  function groupLocalKeyFor(scope) {
    return `${LOCAL_STORAGE_PREFIX}:group:${scope}`;
  }

  function bindTabNavigation() {
    els.tabButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const tab = btn.dataset.tabBtn;
        if (!tab) return;
        setActiveTab(tab);
      });
    });
  }

  function setActiveTab(tab) {
    const allowed = new Set(["summary", "today", "parts", "tune"]);
    const next = allowed.has(tab) ? tab : "tune";
    if (state.activeTab === next) return;
    state.activeTab = next;
    renderTabPanels();
  }

  function renderTabPanels() {
    els.tabPanels.forEach((panel) => {
      panel.hidden = panel.dataset.tabPanel !== state.activeTab;
    });
    els.tabButtons.forEach((btn) => {
      const isActive = btn.dataset.tabBtn === state.activeTab;
      btn.classList.toggle("is-active", isActive);
      btn.setAttribute("aria-pressed", isActive ? "true" : "false");
    });
    try {
      if (telegram && telegram.MainButton) {
        if (state.activeTab === "tune") {
          telegram.MainButton.setText("Сохранить расписание");
          telegram.MainButton.show();
        } else {
          telegram.MainButton.hide();
        }
      }
    } catch (err) {
      logEvent("Ошибка обновления MainButton: " + safeErr(err));
    }
  }

  function openSettingsModal() {
    syncSettingsInputsFromState();
    els.settingsModal.hidden = false;
  }

  function closeSettingsModal() {
    els.settingsModal.hidden = true;
  }

  function applyGlobalSettingsFromModal() {
    state.defaultNoticeMinutesGreen = clampInt(Number(els.defaultNoticeInput.value), 0, 24 * 60, state.defaultNoticeMinutesGreen);
    state.defaultNoticeMinutesBlue = 0;
    applyGlobalZoneNoticesToSegments();
    syncTuneBoundariesFromSegments();
    closeSettingsModal();
    logEvent("Обновлено глобальное N для зеленой зоны.");
    renderAll();
  }

  function syncSettingsInputsFromState() {
    els.defaultNoticeInput.value = String(state.defaultNoticeMinutesGreen);
    if (els.defaultBlueNoticeInput) {
      els.defaultBlueNoticeInput.value = "0";
    }
  }

  function captureScheduleLoadContext() {
    return {
      tuneScope: state.tuneScope,
      mode: state.mode,
      date: String(state.date || ""),
      weekday: String(state.weekday || ""),
    };
  }

  function isStaleScheduleLoad(requestId, ctx) {
    if (requestId !== scheduleLoadRequestSeq) return true;
    if (!ctx) return false;
    return state.tuneScope !== ctx.tuneScope
      || state.mode !== ctx.mode
      || String(state.date || "") !== String(ctx.date || "")
      || String(state.weekday || "") !== String(ctx.weekday || "");
  }

  async function loadSchedule() {
    const requestId = ++scheduleLoadRequestSeq;
    const requestCtx = captureScheduleLoadContext();
    const showTimelineLoading = state.tuneScope === "specific" && state.mode === "override";

    if (showTimelineLoading) {
      state.scheduleLoading = true;
      renderTuneScopeControls();
      renderTimeline();
    } else {
      state.scheduleLoading = false;
    }

    if (isGroupTuneScope()) {
      const loadedGroup = loadLocal(tuneScopeLocalKey());
      state.source = "local";
      state.lastLoadedFrom = "local";
      if (!loadedGroup) {
        state.scheduleLoading = false;
        state.version = null;
        state.dayOff = false;
        state.segments = demoSegments({
          green: state.defaultNoticeMinutesGreen,
          blue: 0,
        });
        syncTuneBoundariesFromSegments();
        logEvent(`Нет сохранённых данных для ${state.tuneScope === "weekdays" ? "будней" : "выходных"}, использован базовый шаблон.`);
        renderAll();
        return;
      }
      state.scheduleLoading = false;
      applyLoadedSchedule(loadedGroup);
      logEvent(`Загружено локально (${state.tuneScope}): ${state.segments.length} сегм.`);
      syncTuneBoundariesFromSegments();
      renderAll();
      return;
    }

    const key = scheduleKey();
    const apiBase = getApiBase();
    const target = state.mode === "override"
      ? `date=${encodeURIComponent(state.date)}`
      : `weekday=${encodeURIComponent(state.weekday)}`;
    const url = `${apiBase ? apiBase.replace(/\/$/, "") : ""}/schedule?mode=${encodeURIComponent(state.mode)}&${target}`;

    logEvent(`Загрузка расписания (${state.mode})...`);

    let loaded = null;
    const preloadedLocal = loadLocal(key);
    const allowOptimisticLocalPreload = !(state.tuneScope === "specific" && state.mode === "override" && apiBase);
    if (preloadedLocal && allowOptimisticLocalPreload) {
      applyLoadedSchedule(preloadedLocal);
      state.source = "local";
      state.lastLoadedFrom = "local";
      renderAll();
    }

    if (apiBase) {
      try {
        loaded = await fetchJson(url, { method: "GET" });
        if (isStaleScheduleLoad(requestId, requestCtx)) return;
        state.source = "api";
        state.lastLoadedFrom = "api";
      } catch (err) {
        if (isStaleScheduleLoad(requestId, requestCtx)) return;
        logEvent(`API недоступен, fallback на localStorage: ${safeErr(err)}`);
      }
    }

    if (isStaleScheduleLoad(requestId, requestCtx)) return;

    if (loaded && preloadedLocal && shouldPreferLocalSpecificOverride(preloadedLocal, loaded)) {
      loaded = preloadedLocal;
      state.source = "local";
      state.lastLoadedFrom = "local";
      logEvent("Оставлена локальная версия даты (API вернул не-override или более старую версию).");
    }

    if (!loaded) {
      loaded = preloadedLocal || loadLocal(key);
      state.source = "local";
      state.lastLoadedFrom = "local";
    }

    if (!loaded) {
      state.scheduleLoading = false;
      state.version = null;
      state.dayOff = false;
      state.segments = demoSegments({
        green: state.defaultNoticeMinutesGreen,
        blue: 0,
      });
      syncTuneBoundariesFromSegments();
      logEvent("Данных не найдено, подставлен demo-шаблон.");
      renderAll();
      return;
    }

    state.scheduleLoading = false;
    applyLoadedSchedule(loaded);
    logEvent(`Загружено (${state.lastLoadedFrom}): ${state.segments.length} сегм.`);
    renderAll();
  }

  function applyLoadedSchedule(payload) {
    const data = payload.data || payload;
    state.lastSchedulePayload = data;
    state.version = data.version || null;
    state.timezone = data.timezone || DEFAULT_TIMEZONE;
    const legacyDefault = Number(data.default_notice_minutes);
    if (Number.isFinite(legacyDefault)) {
      state.defaultNoticeMinutesGreen = clampInt(legacyDefault, 0, 24 * 60, state.defaultNoticeMinutesGreen);
    }
    if (Number.isFinite(Number(data.default_notice_minutes_green))) {
      state.defaultNoticeMinutesGreen = clampInt(Number(data.default_notice_minutes_green), 0, 24 * 60, state.defaultNoticeMinutesGreen);
    }
    if (Number.isFinite(Number(data.default_notice_minutes_blue))) {
      state.defaultNoticeMinutesBlue = clampInt(Number(data.default_notice_minutes_blue), 0, 24 * 60, state.defaultNoticeMinutesBlue);
    }
    if (data.zone_notice_defaults && typeof data.zone_notice_defaults === "object") {
      if (Number.isFinite(Number(data.zone_notice_defaults.OPEN_NOTICE))) {
        state.defaultNoticeMinutesGreen = clampInt(Number(data.zone_notice_defaults.OPEN_NOTICE), 0, 24 * 60, state.defaultNoticeMinutesGreen);
      }
      if (Number.isFinite(Number(data.zone_notice_defaults.OPEN_APPROVAL))) {
        state.defaultNoticeMinutesBlue = clampInt(Number(data.zone_notice_defaults.OPEN_APPROVAL), 0, 24 * 60, state.defaultNoticeMinutesBlue);
      }
    }
    state.defaultNoticeMinutesBlue = 0;
    state.dayOff = resolveDayOffForLoadedSchedule(payload);
    syncSettingsInputsFromState();
    const incoming = Array.isArray(data.segments) ? data.segments : [];
    const parsed = incoming.map(toSlotSegment).filter(Boolean);
    state.segments = parsed.length
      ? canonicalizeSegments(parsed, getZoneNoticeDefaults())
      : demoSegments({
          green: state.defaultNoticeMinutesGreen,
          blue: 0,
        });
    applyGlobalZoneNoticesToSegments();
    syncTuneBoundariesFromSegments();
  }

  async function saveSchedule() {
    if (state.tuneScope === "specific" && state.mode === "override" && state.scheduleLoading) {
      logEvent("Подожди: дата ещё загружается. Сохранение заблокировано до завершения загрузки.");
      return;
    }
    startSaveButtonFx();
    state.segments = canonicalizeSegments(state.segments, getZoneNoticeDefaults());
    syncTuneBoundariesFromSegments();
    const payload = buildPayload();
    if (isGroupTuneScope()) {
      persistLocalMirrorAndVerify(payload);
      state.source = "local";
      state.version = payload.version;
      state.lastLoadedFrom = "local";
      markScheduleSaved();
      applyPostSuccessfulSaveUi();
      logEvent(`Сохранено локально (${state.tuneScope === "weekdays" ? "будни" : "выходные"}).`);
      finishSaveButtonFx(true);
      renderAll();
      return;
    }
    const apiBase = getApiBase();

    logEvent(`Сохранение расписания (${state.mode})...`);

    if (apiBase) {
      try {
        const result = await fetchJson(`${apiBase.replace(/\/$/, "")}/schedule/save`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        state.source = "api";
        state.version = (result && (result.version || (result.data && result.data.version))) || state.version;
        persistLocalMirrorAndVerify(payload);
        markScheduleSaved();
        applyPostSuccessfulSaveUi();
        logEvent("Сохранено через API.");
        finishSaveButtonFx(true);
        renderAll();
        return;
      } catch (err) {
        logEvent(`Ошибка API save, fallback в localStorage: ${safeErr(err)}`);
      }
    }

    persistLocalMirrorAndVerify(payload);
    state.source = "local";
    state.version = payload.version;
    markScheduleSaved();
    applyPostSuccessfulSaveUi();
    logEvent("Сохранено локально (localStorage).");
    finishSaveButtonFx(true);
    renderAll();
  }

  function persistLocalMirrorAndVerify(payload) {
    const key = scheduleKey();
    saveLocal(key, payload);
    const stored = loadLocal(key);
    const version = stored && (stored.version || (stored.data && stored.data.version));
    const ok = !!stored && version === payload.version;
    if (!ok) {
      logEvent("Предупреждение: локальная проверка сохранения не прошла.");
    }
    return ok;
  }

  function buildPayload() {
    const [b1, b2, b3, b4] = normalizeTuneBoundaries(state.tuneBoundaries);
    const version = new Date().toISOString();
    return {
      version,
      timezone: state.timezone || DEFAULT_TIMEZONE,
      mode: isGroupTuneScope() ? "group" : state.mode,
      tune_scope: state.tuneScope,
      date: (!isGroupTuneScope() && state.mode === "override") ? state.date : null,
      weekday: (!isGroupTuneScope() && state.mode === "template") ? Number(state.weekday) : null,
      default_notice_minutes: state.defaultNoticeMinutesGreen,
      default_notice_minutes_green: state.defaultNoticeMinutesGreen,
      default_notice_minutes_blue: 0,
      zone_notice_defaults: {
        OPEN_NOTICE: state.defaultNoticeMinutesGreen,
        OPEN_APPROVAL: 0,
      },
      tune_boundaries: {
        red_blue_left: b1 * SLOT_MINUTES,
        blue_green_left: b2 * SLOT_MINUTES,
        green_blue_right: b3 * SLOT_MINUTES,
        blue_red_right: b4 * SLOT_MINUTES,
      },
      day_off: state.tuneScope === "specific" ? !!state.dayOff : false,
      day_status: state.tuneScope === "specific" ? (state.dayOff ? "off" : "work") : null,
      owner: state.owner
        ? {
            id: state.owner.id,
            username: state.owner.username || null,
            first_name: state.owner.first_name || null,
            last_name: state.owner.last_name || null,
          }
        : null,
      telegram_init_data: telegram ? telegram.initData || null : null,
      segments: state.segments.map((s) => ({
        zone: s.zone,
        start_min: s.startSlot * SLOT_MINUTES,
        end_min: s.endSlot * SLOT_MINUTES,
        notice_minutes: (s.zone === "OPEN_NOTICE" || s.zone === "OPEN_APPROVAL")
          ? clampInt(
              s.noticeMinutes ?? getDefaultNoticeForZone(s.zone) ?? 0,
              0,
              24 * 60,
              getDefaultNoticeForZone(s.zone) ?? 0
            )
          : null,
      })),
    };
  }

  function renderAll() {
    els.storageModeBadge.textContent = state.source;
    els.scheduleVersion.textContent = state.version || "draft";
    els.timezoneValue.textContent = state.timezone || DEFAULT_TIMEZONE;
    syncSettingsInputsFromState();
    renderTuneScopeControls();
    renderTuneCalendarPanel();
    renderTabPanels();
    renderTimeline();
    renderSegments();
    renderWorkTabs();
    renderPreview();
  }

  function renderHourAxis() {
    els.hourAxis.innerHTML = "";
    if (els.hourAxis && els.hourAxis.style) {
      els.hourAxis.style.setProperty("--hour-axis-cols", String(24 - TIMELINE_VISIBLE_START_HOUR));
      els.hourAxis.style.gridTemplateColumns = `repeat(${24 - TIMELINE_VISIBLE_START_HOUR}, 1fr)`;
    }
    for (let h = TIMELINE_VISIBLE_START_HOUR; h < 24; h += 1) {
      const span = document.createElement("span");
      span.textContent = `${String(h).padStart(2, "0")}:00`;
      els.hourAxis.appendChild(span);
    }
  }

  function renderTimeline() {
    if (els.tuneTimelineTitle) {
      if (state.tuneScope === "specific") {
        els.tuneTimelineTitle.textContent = `Таймлайн дня (дата: ${formatIsoDate(state.date)})`;
      } else if (state.tuneScope === "weekends") {
        els.tuneTimelineTitle.textContent = "Таймлайн дня (шаблон выходных)";
      } else {
        els.tuneTimelineTitle.textContent = "Таймлайн дня (шаблон будней)";
      }
    }
    const slotMap = expandToSlots(state.segments, getZoneNoticeDefaults());
    const visualDayOff = state.tuneScope === "specific" && !!state.dayOff;
    const visualLoading = state.tuneScope === "specific" && state.mode === "override" && !!state.scheduleLoading;
    if (els.timelineGridWrap) els.timelineGridWrap.classList.toggle("is-day-off", visualDayOff);
    if (els.timelineGridWrap) els.timelineGridWrap.classList.toggle("is-loading", visualLoading);
    els.timelineGrid.classList.toggle("is-day-off", visualDayOff);
    els.timelineGrid.classList.toggle("is-loading", visualLoading);
    els.timelineBoundaryOverlay.classList.toggle("is-day-off", visualDayOff);
    els.timelineBoundaryOverlay.classList.toggle("is-loading", visualLoading);
    if (els.timelineGrid && els.timelineGrid.style) {
      els.timelineGrid.style.setProperty("--timeline-visible-slots", String(TIMELINE_VISIBLE_SLOT_COUNT));
      const isMobile = typeof window !== "undefined"
        && !!window.matchMedia
        && window.matchMedia("(max-width: 768px)").matches;
      els.timelineGrid.style.gridTemplateColumns = isMobile
        ? `repeat(${TIMELINE_VISIBLE_SLOT_COUNT}, minmax(0, 1fr))`
        : "";
    }
    els.timelineGrid.innerHTML = "";
    if (visualLoading) {
      const loading = document.createElement("div");
      loading.className = "timeline-loading-strip";
      loading.setAttribute("aria-hidden", "true");
      els.timelineGrid.appendChild(loading);
      renderTuneBoundaries();
      return;
    }
    for (let slot = TIMELINE_VISIBLE_START_SLOT; slot < SLOTS_PER_DAY; slot += 1) {
      const div = document.createElement("div");
      div.className = "timeline-slot";
      div.dataset.zone = slotMap[slot].zone;
      if (slot % 4 === 0) {
        div.classList.add("qhour");
      }
      div.title = `${slotToTime(slot)}-${slotToTime(slot + 1)} | ${ZONES[slotMap[slot].zone].label}`;
      els.timelineGrid.appendChild(div);
    }
    renderTuneBoundaries();
  }

  function getZoneNoticeDefaults() {
    return {
      OPEN_NOTICE: clampInt(state.defaultNoticeMinutesGreen, 0, 24 * 60, 90),
      OPEN_APPROVAL: 0,
    };
  }

  function getDefaultNoticeForZone(zone) {
    const defaults = getZoneNoticeDefaults();
    if (zone === "OPEN_NOTICE") return defaults.OPEN_NOTICE;
    if (zone === "OPEN_APPROVAL") return defaults.OPEN_APPROVAL;
    return null;
  }

  function applyGlobalZoneNoticesToSegments() {
    state.segments = (state.segments || []).map((segment) => ({
      ...segment,
      noticeMinutes: getDefaultNoticeForZone(segment.zone) ?? 0,
    }));
    state.segments = canonicalizeSegments(state.segments, getZoneNoticeDefaults());
  }

  function renderSegments() {
    els.segmentsList.innerHTML = "";
    if (!state.segments.length) {
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = "Сегментов нет.";
      els.segmentsList.appendChild(p);
      return;
    }

    state.segments.forEach((segment, index) => {
      const node = els.segmentRowTemplate.content.firstElementChild.cloneNode(true);
      const zoneMeta = ZONES[segment.zone];

      const swatch = node.querySelector(".segment-swatch");
      const title = node.querySelector(".segment-title");
      const zoneSelect = node.querySelector(".segment-zone");
      const startRange = node.querySelector(".segment-start");
      const endRange = node.querySelector(".segment-end");
      const startLabel = node.querySelector(".segment-start-label");
      const endLabel = node.querySelector(".segment-end-label");
      const noticeInput = node.querySelector(".segment-notice");
      const durationChip = node.querySelector(".segment-duration");
      const noteChip = node.querySelector(".segment-note");
      const removeBtn = node.querySelector(".remove-segment-btn");

      swatch.classList.add(zoneMeta.className);
      title.textContent = `${index + 1}. ${zoneMeta.label}`;

      for (const [zoneKey, info] of Object.entries(ZONES)) {
        const option = document.createElement("option");
        option.value = zoneKey;
        option.textContent = info.label;
        if (zoneKey === segment.zone) option.selected = true;
        zoneSelect.appendChild(option);
      }

      startRange.value = String(segment.startSlot);
      endRange.value = String(segment.endSlot);
      startLabel.textContent = slotToTime(segment.startSlot);
      endLabel.textContent = slotToTime(segment.endSlot);
      noticeInput.value = String(getDefaultNoticeForZone(segment.zone) ?? 0);
      noticeInput.disabled = true;

      const durationMin = (segment.endSlot - segment.startSlot) * SLOT_MINUTES;
      durationChip.textContent = `${durationMin} мин (${formatDuration(durationMin)})`;
      noteChip.textContent = zoneMeta.note;

      zoneSelect.addEventListener("change", () => {
        patchSegment(index, {
          zone: zoneSelect.value,
          noticeMinutes: getDefaultNoticeForZone(zoneSelect.value) ?? 0,
        });
      });

      startRange.addEventListener("input", () => {
        let start = Number(startRange.value);
        let end = Number(endRange.value);
        if (start >= end) {
          end = Math.min(SLOTS_PER_DAY, start + 1);
          endRange.value = String(end);
        }
        patchSegment(index, { startSlot: start, endSlot: end });
      });

      endRange.addEventListener("input", () => {
        let start = Number(startRange.value);
        let end = Number(endRange.value);
        if (end <= start) {
          start = Math.max(0, end - 1);
          startRange.value = String(start);
        }
        patchSegment(index, { startSlot: start, endSlot: end });
      });

      removeBtn.addEventListener("click", () => {
        state.segments.splice(index, 1);
        state.segments = canonicalizeSegments(state.segments, getZoneNoticeDefaults());
        logEvent(`Удален сегмент #${index + 1}.`);
        renderAll();
      });

      els.segmentsList.appendChild(node);
    });
  }

  function patchSegment(index, patch) {
    const current = state.segments[index];
    if (!current) return;
    state.segments[index] = {
      ...current,
      ...patch,
      startSlot: clampInt(Number((patch.startSlot ?? current.startSlot)), 0, SLOTS_PER_DAY - 1, 0),
      endSlot: clampInt(Number((patch.endSlot ?? current.endSlot)), 1, SLOTS_PER_DAY, SLOTS_PER_DAY),
      noticeMinutes: clampInt(
        Number((patch.noticeMinutes ?? current.noticeMinutes ?? getDefaultNoticeForZone(patch.zone ?? current.zone) ?? 0)),
        0,
        24 * 60,
        getDefaultNoticeForZone(patch.zone ?? current.zone) ?? 0
      ),
    };
    if (state.segments[index].endSlot <= state.segments[index].startSlot) {
      state.segments[index].endSlot = Math.min(SLOTS_PER_DAY, state.segments[index].startSlot + 1);
    }
    state.segments = canonicalizeSegments(state.segments, getZoneNoticeDefaults());
    renderAll();
  }

  function addSegment() {
    const candidate = {
      zone: "OPEN_NOTICE",
      startSlot: minsToSlot(10 * 60),
      endSlot: minsToSlot(18 * 60),
      noticeMinutes: getDefaultNoticeForZone("OPEN_NOTICE") ?? 0,
    };
    state.segments = canonicalizeSegments(state.segments.concat(candidate), getZoneNoticeDefaults());
    logEvent("Добавлен сегмент OPEN_NOTICE (10:00-18:00).");
    renderAll();
  }

  function copyPreviousDayLocal() {
    if (state.mode !== "override") {
      logEvent("Копирование вчера работает только в режиме конкретной даты.");
      return;
    }
    const prevKey = localKeyFor("override", addDaysISO(state.date, -1), null);
    const prev = loadLocal(prevKey);
    if (!prev) {
      logEvent("В localStorage нет сохраненного расписания за предыдущий день.");
      return;
    }
    applyLoadedSchedule(prev);
    state.source = "local";
    logEvent(`Скопировано локально из ${addDaysISO(state.date, -1)}.`);
    renderAll();
  }

  function renderPreview() {
    els.payloadPreview.textContent = JSON.stringify(buildPayload(), null, 2);
  }

  function renderWorkTabs() {
    const snapshot = getTodayWorkSnapshot();
    renderTodayArrivalsTab(snapshot);
    renderTodayPartsTab(snapshot);
    renderTodaySummaryTab(snapshot);
  }

  function getTodayWorkSnapshot() {
    const today = todayISO();
    const openWindows = buildOpenWindowsFromSegments(state.segments);
    const backend = state.lastSchedulePayload && state.lastSchedulePayload.today_dashboard;

    if (backend && typeof backend === "object") {
      const arrivals = Array.isArray(backend.arrivals) ? backend.arrivals : [];
      const parts = Array.isArray(backend.parts) ? backend.parts : [];
      const notes = Array.isArray(backend.notes) ? backend.notes : [];
      return finalizeWorkSnapshot({
        date: backend.date || today,
        source: backend.source ? String(backend.source) : "api",
        arrivals: arrivals.map(normalizeArrivalItem).filter(Boolean),
        parts: parts.map(normalizePartItem).filter(Boolean),
        notes: notes.map((n) => String(n)).filter(Boolean),
        openWindows,
      });
    }

    return finalizeWorkSnapshot(buildDemoTodayWorkSnapshot(today, openWindows));
  }

  function buildDemoTodayWorkSnapshot(date, openWindows) {
    const fallbackTimes = ["11:00", "13:30", "16:00", "18:30"];
    const times = (openWindows.length ? openWindows.map((w) => w.start).slice(0, 4) : []).map((t, i) => {
      if (i === 0) return t;
      return shiftTimeString(t, 30);
    });
    while (times.length < 4) {
      times.push(fallbackTimes[times.length]);
    }

    return {
      date,
      source: "demo",
      arrivals: [
        {
          time: times[0],
          title: "Алексей / F10 — установка комплекта",
          subtitle: "Подтвержден, приедет с предупреждением",
          statusLabel: "Подтвержден",
          statusTone: "ok",
        },
        {
          time: times[1],
          title: "Игорь / E70 — самовывоз детали",
          subtitle: "Нужно проверить остаток (1 шт на складе)",
          statusLabel: "Уточнить у Коли",
          statusTone: "warn",
        },
        {
          time: times[2],
          title: "Роман / F30 — вопрос по установке",
          subtitle: "Рекомендуется fallback в Telegram",
          statusLabel: "Согласование",
          statusTone: "warn",
        },
        {
          time: times[3],
          title: "Окно под запись",
          subtitle: "Можно занять под срочный приезд",
          statusLabel: "Свободно",
          statusTone: "ok",
        },
      ],
      parts: [
        {
          qty: 1,
          title: "КОМПЛЕКТ F10 передние черные",
          subtitle: "Клиент: Игорь, ориентир " + times[1],
          statusLabel: "Проверить остаток",
          statusTone: "warn",
        },
        {
          qty: 2,
          title: "Кнопка руля F10 (левая/правая)",
          subtitle: "Под выдачу и фото-подтверждение",
          statusLabel: "Готово",
          statusTone: "ok",
        },
        {
          qty: 1,
          title: "Селектор E70 (карбон)",
          subtitle: "Клиент спрашивал совместимость",
          statusLabel: "Нужна консультация",
          statusTone: "warn",
        },
      ],
      notes: [
        "Если вопрос про установку/комплектацию — эскалировать в Telegram.",
        "Остаток = 1: не подтверждать автоматически без Коли.",
        "Фото лучше отправлять из каталога модели, top-2.",
      ],
      openWindows,
    };
  }

  function finalizeWorkSnapshot(snapshot) {
    const safe = snapshot && typeof snapshot === "object" ? snapshot : {};
    const arrivals = Array.isArray(safe.arrivals) ? safe.arrivals : [];
    const parts = Array.isArray(safe.parts) ? safe.parts : [];
    const notes = Array.isArray(safe.notes) ? safe.notes : [];
    const openWindows = Array.isArray(safe.openWindows) ? safe.openWindows : [];

    const totalPartsQty = parts.reduce((sum, p) => sum + Math.max(0, Number(p.qty) || 0), 0);
    const approvals = arrivals.filter((a) => a.statusTone === "warn" || a.statusTone === "danger").length
      + parts.filter((p) => p.statusTone === "warn" || p.statusTone === "danger").length;
    const openMinutes = openWindows.reduce((sum, w) => sum + (Number(w.durationMin) || 0), 0);

    return {
      date: typeof safe.date === "string" ? safe.date : todayISO(),
      source: typeof safe.source === "string" ? safe.source : "demo",
      arrivals,
      parts,
      notes,
      openWindows,
      summary: {
        arrivalsCount: arrivals.length,
        partsLinesCount: parts.length,
        totalPartsQty,
        approvalsCount: approvals,
        openWindowsCount: openWindows.length,
        openMinutes,
      },
    };
  }

  function normalizeArrivalItem(raw) {
    if (!raw || typeof raw !== "object") return null;
    return {
      time: typeof raw.time === "string" ? raw.time : "00:00",
      title: String(raw.title || raw.customer || "Клиент"),
      subtitle: String(raw.subtitle || raw.note || ""),
      statusLabel: String(raw.statusLabel || raw.status || "Без статуса"),
      statusTone: normalizeStatusTone(raw.statusTone || raw.status),
    };
  }

  function normalizePartItem(raw) {
    if (!raw || typeof raw !== "object") return null;
    return {
      qty: Math.max(0, Number(raw.qty) || 0),
      title: String(raw.title || raw.name || "Деталь"),
      subtitle: String(raw.subtitle || raw.note || ""),
      statusLabel: String(raw.statusLabel || raw.status || "Без статуса"),
      statusTone: normalizeStatusTone(raw.statusTone || raw.status),
    };
  }

  function normalizeStatusTone(value) {
    const v = String(value || "").toLowerCase();
    if (["ok", "done", "confirmed", "ready", "available"].includes(v)) return "ok";
    if (["danger", "error", "stop", "none", "missing"].includes(v)) return "danger";
    return "warn";
  }

  function renderTodayArrivalsTab(snapshot) {
    els.todayArrivalsMeta.textContent = `${formatIsoDate(snapshot.date)} • ${snapshot.arrivals.length} записей • источник: ${snapshot.source}`;
    renderList(
      els.todayArrivalsList,
      snapshot.arrivals.map((item) => ({
        time: item.time,
        title: item.title,
        subtitle: item.subtitle,
        statusLabel: item.statusLabel,
        statusTone: item.statusTone,
      })),
      "На сегодня записей пока нет"
    );
  }

  function renderTodayPartsTab(snapshot) {
    els.todayPartsMeta.textContent = `${formatIsoDate(snapshot.date)} • ${snapshot.summary.partsLinesCount} позиций • всего штук: ${snapshot.summary.totalPartsQty}`;
    renderList(
      els.todayPartsList,
      snapshot.parts.map((item) => ({
        time: item.qty > 0 ? `x${item.qty}` : "-",
        title: item.title,
        subtitle: item.subtitle,
        statusLabel: item.statusLabel,
        statusTone: item.statusTone,
      })),
      "На сегодня детали еще не сформированы"
    );
  }

  function renderTodaySummaryTab(snapshot) {
    els.todaySummaryMeta.textContent = `${formatIsoDate(snapshot.date)} • источник: ${snapshot.source}`;
    renderKpis(els.todaySummaryKpis, [
      { label: "Записи", value: String(snapshot.summary.arrivalsCount) },
      { label: "Детали (строки)", value: String(snapshot.summary.partsLinesCount) },
      { label: "Штук деталей", value: String(snapshot.summary.totalPartsQty) },
      { label: "Требуют внимания", value: String(snapshot.summary.approvalsCount) },
      { label: "Окон работы", value: String(snapshot.summary.openWindowsCount) },
      { label: "Открыто минут", value: String(snapshot.summary.openMinutes) },
    ]);

    renderList(
      els.todayOpenWindowsList,
      snapshot.openWindows.map((w) => ({
        time: `${w.start}–${w.end}`,
        title: w.title,
        subtitle: w.subtitle,
        statusLabel: w.statusLabel,
        statusTone: w.statusTone,
        compact: true,
      })),
      "Окон работы нет (день закрыт)"
    );

    const notesItems = (snapshot.notes || []).map((note, idx) => ({
      title: `Пункт ${idx + 1}`,
      subtitle: note,
      statusLabel: "Фокус",
      statusTone: "warn",
      twoCol: true,
    }));
    renderList(els.todaySummaryNotes, notesItems, "Пока без заметок");
  }

  function renderKpis(container, kpis) {
    container.innerHTML = "";
    kpis.forEach((kpi) => {
      const card = document.createElement("div");
      card.className = "kpi-card";
      const label = document.createElement("div");
      label.className = "kpi-label";
      label.textContent = kpi.label;
      const value = document.createElement("div");
      value.className = "kpi-value";
      value.textContent = kpi.value;
      card.appendChild(label);
      card.appendChild(value);
      container.appendChild(card);
    });
  }

  function renderList(container, items, emptyMessage) {
    container.innerHTML = "";
    if (!Array.isArray(items) || items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = emptyMessage;
      container.appendChild(empty);
      return;
    }

    items.forEach((item) => {
      const row = document.createElement("div");
      row.className = "work-item";
      if (item.twoCol) row.classList.add("two-col");

      if (!item.twoCol) {
        const left = document.createElement("div");
        left.className = "time-pill";
        left.textContent = item.time || "--:--";
        row.appendChild(left);
      }

      const main = document.createElement("div");
      main.className = "main";
      const title = document.createElement("div");
      title.className = "title";
      title.textContent = item.title || "";
      main.appendChild(title);
      if (item.subtitle) {
        const sub = document.createElement("div");
        sub.className = "sub";
        sub.textContent = item.subtitle;
        main.appendChild(sub);
      }
      row.appendChild(main);

      const status = document.createElement("div");
      status.className = `status-pill is-${normalizeStatusTone(item.statusTone)}`;
      status.textContent = item.statusLabel || "OK";
      row.appendChild(status);

      container.appendChild(row);
    });
  }

  function buildOpenWindowsFromSegments(segments) {
    const list = [];
    (segments || []).forEach((segment) => {
      if (!segment || segment.zone === "CLOSED") return;
      const start = slotToTime(segment.startSlot);
      const end = slotToTime(segment.endSlot);
      const durationMin = Math.max(0, (segment.endSlot - segment.startSlot) * SLOT_MINUTES);
      const zoneLabel = segment.zone === "OPEN_NOTICE" ? "Зеленая зона" : "Синяя зона";
      const notice = segment.zone === "OPEN_NOTICE"
        ? `N=${getDefaultNoticeForZone("OPEN_NOTICE")} мин`
        : `N=${getDefaultNoticeForZone("OPEN_APPROVAL")} мин`;
      list.push({
        start,
        end,
        durationMin,
        title: zoneLabel,
        subtitle: `${formatDuration(durationMin)} • ${notice}`,
        statusLabel: segment.zone === "OPEN_NOTICE" ? "Авто" : "Согласование",
        statusTone: segment.zone === "OPEN_NOTICE" ? "ok" : "warn",
      });
    });
    return list;
  }

  function shiftTimeString(time, plusMinutes) {
    const m = /^(\d{2}):(\d{2})$/.exec(String(time || ""));
    if (!m) return "00:00";
    const total = Math.max(0, Math.min(24 * 60 - 1, Number(m[1]) * 60 + Number(m[2]) + Number(plusMinutes || 0)));
    const hh = String(Math.floor(total / 60)).padStart(2, "0");
    const mm = String(total % 60).padStart(2, "0");
    return `${hh}:${mm}`;
  }

  function formatIsoDate(isoDate) {
    try {
      const d = new Date(`${isoDate}T12:00:00`);
      return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
    } catch {
      return String(isoDate || "");
    }
  }

  function hydrateControlsFromState() {
    els.modeSelect.value = state.mode;
    els.dateInput.value = state.date;
    els.weekdaySelect.value = state.weekday;
    syncSettingsInputsFromState();
    toggleModeFields();
  }

  function toggleModeFields() {
    const modeField = els.modeSelect.closest(".field");
    if (modeField) modeField.hidden = true;
    if (state.tuneScope !== "specific") {
      els.dateFieldWrap.hidden = true;
      els.weekdayFieldWrap.hidden = true;
      return;
    }
    els.dateFieldWrap.hidden = false;
    els.weekdayFieldWrap.hidden = true;
  }

  function scheduleKey() {
    if (isGroupTuneScope()) {
      return tuneScopeLocalKey();
    }
    return localKeyFor(state.mode, state.date, state.weekday);
  }

  function localKeyFor(mode, date, weekday) {
    const suffix = mode === "override" ? `date:${date}` : `weekday:${weekday}`;
    return `${LOCAL_STORAGE_PREFIX}:${suffix}`;
  }

  function saveLocal(key, payload) {
    try {
      localStorage.setItem(key, JSON.stringify(payload));
    } catch (err) {
      logEvent("Ошибка localStorage save: " + safeErr(err));
    }
  }

  function loadLocal(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      logEvent("Ошибка localStorage read: " + safeErr(err));
      return null;
    }
  }

  function clearAllScheduleLocalCaches() {
    try {
      const prefixes = [
        `${LOCAL_STORAGE_PREFIX}:date:`,
        `${LOCAL_STORAGE_PREFIX}:weekday:`,
        `${LOCAL_STORAGE_PREFIX}:group:`,
      ];
      const toDelete = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (!key) continue;
        if (prefixes.some((p) => key.startsWith(p))) {
          toDelete.push(key);
        }
      }
      toDelete.forEach((key) => localStorage.removeItem(key));
    } catch (err) {
      logEvent("Ошибка очистки localStorage: " + safeErr(err));
    }
  }

  function getApiBase() {
    const fromWindow = typeof window.__SCHEDULE_API_BASE__ === "string" ? window.__SCHEDULE_API_BASE__ : "";
    const fromQuery = (() => {
      try {
        const u = new URL(window.location.href);
        return u.searchParams.get("api_base") || "";
      } catch {
        return "";
      }
    })();
    const fromLocal = localStorage.getItem(`${LOCAL_STORAGE_PREFIX}:api_base`) || "";
    if (fromWindow || fromQuery || fromLocal) {
      return (fromWindow || fromQuery || fromLocal || "").trim();
    }
    if (typeof window !== "undefined" && window.location && /^https?:$/i.test(window.location.protocol)) {
      const host = String(window.location.hostname || "").toLowerCase();
      if (host === "hellobimmer.com" || host.endsWith(".hellobimmer.com")) {
        return `${window.location.origin}/webhook/bmwbot-owner-schedule`;
      }
      return "https://hellobimmer.com/webhook/bmwbot-owner-schedule";
    }
    return "";
  }

  async function fetchJson(url, init) {
    const headers = new Headers(init && init.headers ? init.headers : {});
    if (telegram && telegram.initData) {
      headers.set("X-Telegram-Init-Data", telegram.initData);
    }
    const response = await fetch(url, { ...init, headers });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
    }
    return response.json();
  }

  function expandToSlots(segments, zoneDefaults) {
    const defaults = zoneDefaults || getZoneNoticeDefaults();
    const slots = Array.from({ length: SLOTS_PER_DAY }, () => ({
      zone: "CLOSED",
      noticeMinutes: null,
    }));
    for (const seg of segments) {
      const start = clampInt(seg.startSlot, 0, SLOTS_PER_DAY, 0);
      const end = clampInt(seg.endSlot, 0, SLOTS_PER_DAY, 0);
      if (end <= start) continue;
      for (let i = start; i < end; i += 1) {
        slots[i] = {
          zone: seg.zone in ZONES ? seg.zone : "CLOSED",
          noticeMinutes: (seg.zone === "OPEN_NOTICE" || seg.zone === "OPEN_APPROVAL")
            ? clampInt(
                seg.noticeMinutes ?? defaults[seg.zone] ?? 0,
                0,
                24 * 60,
                defaults[seg.zone] ?? 0
              )
            : null,
        };
      }
    }
    return slots;
  }

  function canonicalizeSegments(rawSegments, zoneDefaults) {
    const defaults = zoneDefaults || getZoneNoticeDefaults();
    const slots = expandToSlots(rawSegments, defaults);
    const result = [];
    let current = { ...slots[0] };
    let start = 0;

    for (let i = 1; i <= SLOTS_PER_DAY; i += 1) {
      const atEnd = i === SLOTS_PER_DAY;
      const next = atEnd ? null : slots[i];
      const compareNotices = (
        next &&
        current &&
        (next.zone === "OPEN_NOTICE" || next.zone === "OPEN_APPROVAL") &&
        next.zone === current.zone
      );
      const changed = atEnd
        || next.zone !== current.zone
        || (compareNotices && next.noticeMinutes !== current.noticeMinutes);

      if (changed) {
        result.push({
          zone: current.zone,
          startSlot: start,
          endSlot: i,
          noticeMinutes: (current.zone === "OPEN_NOTICE" || current.zone === "OPEN_APPROVAL")
            ? clampInt(current.noticeMinutes ?? defaults[current.zone] ?? 0, 0, 24 * 60, defaults[current.zone] ?? 0)
            : 0,
        });
        if (!atEnd) {
          start = i;
          current = { ...next };
        }
      }
    }

    return result;
  }

  function toSlotSegment(segment) {
    if (!segment || typeof segment !== "object") return null;
    let startSlot = null;
    let endSlot = null;
    if (Number.isFinite(Number(segment.startSlot)) && Number.isFinite(Number(segment.endSlot))) {
      startSlot = Number(segment.startSlot);
      endSlot = Number(segment.endSlot);
    } else if (Number.isFinite(Number(segment.start_min)) && Number.isFinite(Number(segment.end_min))) {
      startSlot = minsToSlot(Number(segment.start_min));
      endSlot = minsToSlot(Number(segment.end_min));
    } else {
      return null;
    }
    const zone = typeof segment.zone === "string" && segment.zone in ZONES ? segment.zone : "CLOSED";
    const zoneDefaultNotice = getDefaultNoticeForZone(zone) ?? 0;
    return {
      zone,
      startSlot: clampInt(startSlot, 0, SLOTS_PER_DAY - 1, 0),
      endSlot: clampInt(endSlot, 1, SLOTS_PER_DAY, SLOTS_PER_DAY),
      noticeMinutes: clampInt(Number(segment.notice_minutes ?? segment.noticeMinutes ?? zoneDefaultNotice), 0, 24 * 60, zoneDefaultNotice),
    };
  }

  function demoSegments(defaults) {
    const green = clampInt(Number(defaults && defaults.green), 0, 24 * 60, 90);
    const blue = 0;
    return canonicalizeSegments(
      [
        { zone: "CLOSED", startSlot: 0, endSlot: minsToSlot(9 * 60), noticeMinutes: 0 },
        { zone: "OPEN_APPROVAL", startSlot: minsToSlot(9 * 60), endSlot: minsToSlot(10 * 60), noticeMinutes: blue },
        { zone: "OPEN_NOTICE", startSlot: minsToSlot(10 * 60), endSlot: minsToSlot(18 * 60), noticeMinutes: green },
        { zone: "OPEN_APPROVAL", startSlot: minsToSlot(18 * 60), endSlot: minsToSlot(19 * 60), noticeMinutes: blue },
        { zone: "CLOSED", startSlot: minsToSlot(19 * 60), endSlot: SLOTS_PER_DAY, noticeMinutes: 0 },
      ],
      { OPEN_NOTICE: green, OPEN_APPROVAL: blue }
    );
  }

  function minsToSlot(minutes) {
    return Math.round(Number(minutes) / SLOT_MINUTES);
  }

  function slotToTime(slot) {
    const minutes = clampInt(slot, 0, SLOTS_PER_DAY, 0) * SLOT_MINUTES;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  function formatDuration(minutes) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h && m) return `${h}ч ${m}м`;
    if (h) return `${h}ч`;
    return `${m}м`;
  }

  function todayISO() {
    const d = new Date();
    return toISODate(d);
  }

  function addDaysISO(isoDate, days) {
    const d = new Date(`${isoDate}T12:00:00`);
    d.setDate(d.getDate() + days);
    return toISODate(d);
  }

  function toISODate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function clampInt(value, min, max, fallback) {
    if (!Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, Math.round(value)));
  }

  function safeErr(err) {
    if (!err) return "unknown error";
    return err.message || String(err);
  }

  function logEvent(message) {
    const row = document.createElement("div");
    row.className = "log-entry";
    const ts = document.createElement("div");
    ts.className = "time";
    ts.textContent = new Date().toLocaleTimeString("ru-RU");
    const msg = document.createElement("div");
    msg.className = "msg";
    msg.textContent = message;
    row.appendChild(ts);
    row.appendChild(msg);
    els.eventLog.prepend(row);
    while (els.eventLog.children.length > 60) {
      els.eventLog.removeChild(els.eventLog.lastChild);
    }
  }

  function byId(id) {
    const el = document.getElementById(id);
    if (!el) throw new Error(`Missing element #${id}`);
    return el;
  }

  function byIdOptional(id) {
    return document.getElementById(id);
  }
})();
