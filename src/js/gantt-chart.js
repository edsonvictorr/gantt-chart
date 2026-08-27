(function () {
    "use strict";

    $(function () {
        var tarefasBrutas = window.tarefasBrutasMonitoramento || [];
        var ROW_HEIGHT = 44;
        var MS_PER_DAY = 24 * 60 * 60 * 1000;
        var ZOOM_LEVELS = [
            { key: "dia", label: "Dia", dayWidth: 36 },
            { key: "semana", label: "Semana", dayWidth: 14 },
            { key: "mes", label: "Mês", dayWidth: 6 },
            { key: "trimestre", label: "Trimestre", dayWidth: 2.2 },
            { key: "ano", label: "Ano", dayWidth: 0.9 }
        ];
        var GRID_LAYOUT_BY_ZOOM = [
            { width: 620, cols: [60, 92, "1fr", 90, 90, 50] },
            { width: 580, cols: [56, 86, "1fr", 84, 84, 46] },
            { width: 540, cols: [52, 80, "1fr", 78, 78, 44] },
            { width: 500, cols: [48, 74, "1fr", 72, 72, 40] },
            { width: 460, cols: [44, 68, "1fr", 66, 66, 38] }
        ];
        var MONTH_NAMES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

        var zoomIndex = 0;
        var collapsed = {};
        var renderedOnce = false;
        var resizeTimer = null;
        var signalrRefreshTimer = null;
        var TIMELINE_SPEEDS = [1, 5, 10, 20, 50, 100];
        var CHART_SCALE_PRESETS = [70, 80, 90, 100];
        var chartScalePercent = 100;
        var timelineState = {
            mode: "gantt",
            speed: 1,
            isPlaying: false,
            awaitingStart: true,
            simulatedDate: null,
            projectStart: null,
            projectEnd: null,
            tickTimer: null,
            rafId: null,
            lastTickAt: null,
            lastRenderAt: null,
            currentSpeed: 0,
            renderMetrics: null,
            isAutoScrolling: false,
            suspendAutoScrollUntil: 0,
            userScrollActiveUntil: 0,
            suppressScrollMarkUntil: 0,
            isRestoringViewport: false,
            lastViewportRatio: null
        };

        function parseDate(texto) {
            if (!texto) { return null; }
            var t = String(texto);
            var m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
            if (m) {
                var dataIso = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
                return isNaN(dataIso.getTime()) ? null : dataIso;
            }
            var partes = t.split("/");
            if (partes.length === 3) {
                var d = parseInt(partes[0], 10);
                var mm = parseInt(partes[1], 10);
                var y = parseInt(partes[2], 10);
                var dataBr = new Date(y, mm - 1, d);
                return isNaN(dataBr.getTime()) ? null : dataBr;
            }
            return null;
        }

        function cloneDate(d) {
            return new Date(d.getFullYear(), d.getMonth(), d.getDate());
        }

        function addDays(date, n) {
            var d = cloneDate(date);
            d.setDate(d.getDate() + n);
            return d;
        }

        function diffDays(a, b) {
            return Math.round((cloneDate(b).getTime() - cloneDate(a).getTime()) / MS_PER_DAY);
        }

        function diffDaysPrecise(a, b) {
            return (b.getTime() - a.getTime()) / MS_PER_DAY;
        }

        function isWeekend(date) {
            var dow = date.getDay();
            return dow === 0 || dow === 6;
        }

        function normalizeText(v) {
            return (v || "")
                .toString()
                .trim()
                .toLowerCase()
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "");
        }

        function tipoClass(tipoRaw) {
            var t = normalizeText(tipoRaw);
            if (t.indexOf("acao") >= 0) { return "g-tipo-acao"; }
            if (t.indexOf("atividade") >= 0) { return "g-tipo-atividade"; }
            if (t.indexOf("tarefa") >= 0) { return "g-tipo-tarefa"; }
            if (t.indexOf("demanda") >= 0) { return "g-tipo-demanda"; }
            if (t.indexOf("projeto") >= 0) { return "g-tipo-projeto"; }
            return "g-tipo-outro";
        }

        function normalizeSituacaoNome(situacao) {
            var s = normalizeText(situacao);

            if (s.indexOf("cancel") >= 0) { return "cancelado"; }
            if (s.indexOf("concl") >= 0) { return "concluido"; }
            if (s.indexOf("elabor") >= 0 || s.indexOf("aguard") >= 0 || s.indexOf("liberad") >= 0 || s.indexOf("nao inici") >= 0) { return "nao_iniciado"; }
            if (s.indexOf("andamento") >= 0 || s.indexOf("public") >= 0) { return "andamento"; }
            return "";
        }

        function resolveStatus(task, hoje) {
            var fromSituacao = normalizeSituacaoNome(task.situacaoRaw);
            var status = "nao_iniciado";
            var prazoReferencia = task.ownEnd || task.end;

            if (fromSituacao === "cancelado") {
                status = "cancelado";
            } else if (fromSituacao === "concluido") {
                status = "concluido";
            } else if (fromSituacao === "nao_iniciado") {
                status = "nao_iniciado";
            } else if (fromSituacao === "andamento") {
                status = task.progress > 0 ? "andamento" : "nao_iniciado";
            } else if (task.progress >= 100) {
                status = "concluido";
            } else if (task.progress > 0 && task.progress < 100) {
                status = "andamento";
            }

            var atrasado = false;
            if (status === "concluido") {
                if (task.dataEncerramento && prazoReferencia && task.dataEncerramento > prazoReferencia) {
                    atrasado = true;
                }
            } else if (status !== "cancelado") {
                if (prazoReferencia && prazoReferencia < hoje) {
                    atrasado = true;
                }
            }

            var proximoVencimento = false;
            if (!atrasado && status !== "cancelado" && status !== "concluido" && prazoReferencia) {
                var diasParaVencer = diffDays(hoje, prazoReferencia);
                if (diasParaVencer >= 0 && diasParaVencer <= 2) {
                    proximoVencimento = true;
                }
            }

            var combinedKey = status;
            var label = "";

            if (status === "cancelado") {
                combinedKey = "cancelado";
                label = "Cancelado";
            } else if (status === "concluido") {
                combinedKey = atrasado ? "concluido_atrasado" : "concluido_prazo";
                label = atrasado ? "Concluído com atraso" : "Concluído no prazo";
            } else if (status === "andamento") {
                combinedKey = atrasado ? "andamento_atrasado" : "andamento_prazo";
                label = atrasado ? "Em andamento (atrasado)" : "Em andamento (no prazo)";
            } else {
                combinedKey = atrasado ? "nao_iniciado_atrasado" : "nao_iniciado";
                label = atrasado ? "Não iniciado (atrasado)" : "Não iniciado";
            }

            if (proximoVencimento) {
                label += " - Vencimento próximo";
            }

            return {
                key: status,
                combinedKey: combinedKey,
                label: label,
                atrasado: atrasado,
                proximoVencimento: proximoVencimento
            };
        }


        function formatDateBr(d) {
            if (!d) { return "-"; }
            var dd = ("0" + d.getDate()).slice(-2);
            var mm = ("0" + (d.getMonth() + 1)).slice(-2);
            var yy = d.getFullYear();
            return dd + "/" + mm + "/" + yy;
        }

        function escapeHtml(v) {
            return (v || "")
                .toString()
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#39;");
        }

        function compareCode(a, b) {
            var aa = (a || "").toString().split(".");
            var bb = (b || "").toString().split(".");
            var len = Math.max(aa.length, bb.length);
            for (var i = 0; i < len; i++) {
                var pa = aa[i];
                var pb = bb[i];
                if (typeof pa === "undefined") { return -1; }
                if (typeof pb === "undefined") { return 1; }
                var na = parseInt(pa, 10);
                var nb = parseInt(pb, 10);
                var aNum = !isNaN(na) && String(na) === pa;
                var bNum = !isNaN(nb) && String(nb) === pb;
                if (aNum && bNum && na !== nb) { return na - nb; }
                if (pa !== pb) { return pa.localeCompare(pb); }
            }
            return 0;
        }

        function normalizeTasks(raw) {
            var map = {};
            var roots = [];

            raw.forEach(function (t, idx) {
                var id = String(t.Id);
                var ownStart = parseDate(t.OwnStart || t.Start);
                var ownEnd = parseDate(t.OwnEnd || t.End);
                var start = parseDate(t.Start) || (ownStart ? cloneDate(ownStart) : null);
                var end = parseDate(t.End) || (ownEnd ? cloneDate(ownEnd) : null);

                if (!ownStart && ownEnd) { ownStart = cloneDate(ownEnd); }
                if (!ownEnd && ownStart) { ownEnd = cloneDate(ownStart); }

                if (!start && end) { start = cloneDate(end); }
                if (!end && start) { end = cloneDate(start); }

                map[id] = {
                    id: id,
                    parentId: t.ParentId ? String(t.ParentId) : null,
                    codigo: (t.Codigo || "").trim(),
                    nome: t.NomeOriginal || t.NomeExibicao || "Sem nome",
                    tipo: t.Tipo || "",
                    situacaoRaw: t.Situacao || "",
                    ownStart: ownStart,
                    ownEnd: ownEnd,
                    start: start,
                    end: end,
                    dataEncerramento: parseDate(t.DataEncerramento),
                    progress: Math.max(0, Math.min(100, parseInt(t.Progress, 10) || 0)),
                    marcoOriginal: !!t.Marco,
                    evidencia: t.Evidencia || "",
                    responsaveis: t.Responsaveis || [],
                    integrantes: t.Integrantes || [],
                    pessoas: t.Pessoas || [],
                    envolvidos: t.Envolvidos || [],
                    ordemOriginal: idx,
                    children: [],
                    hasChildren: false,
                    marco: false,
                    level: 0,
                    statusInfo: null
                };
            });

            Object.keys(map).forEach(function (id) {
                var node = map[id];
                var parent = node.parentId ? map[node.parentId] : null;
                if (parent) {
                    parent.children.push(node);
                } else {
                    roots.push(node);
                }
            });

            function order(list) {
                list.sort(function (a, b) {
                    var codeOrder = compareCode(a.codigo, b.codigo);
                    if (codeOrder !== 0) { return codeOrder; }
                    return a.ordemOriginal - b.ordemOriginal;
                });
                list.forEach(function (x) { order(x.children); });
            }

            function rollup(node) {
                var childMin = null;
                var childMax = null;

                node.children.forEach(function (child) {
                    rollup(child);
                    if (child.start && (!childMin || child.start < childMin)) { childMin = child.start; }
                    if (child.end && (!childMax || child.end > childMax)) { childMax = child.end; }
                });

                var starts = [];
                var ends = [];
                if (node.ownStart) { starts.push(node.ownStart); }
                if (node.ownEnd) { ends.push(node.ownEnd); }
                if (childMin) { starts.push(childMin); }
                if (childMax) { ends.push(childMax); }

                node.start = starts.length ? new Date(Math.min.apply(null, starts.map(function (x) { return x.getTime(); }))) : null;
                node.end = ends.length ? new Date(Math.max.apply(null, ends.map(function (x) { return x.getTime(); }))) : null;
                node.hasChildren = node.children.length > 0;
                node.marco = false;
            }

            var flat = [];
            var hoje = new Date();
            hoje.setHours(0, 0, 0, 0);

            function flatten(list, level, ancestorLines) {
                list.forEach(function (n, index) {
                    var isLast = index === list.length - 1;
                    n.level = level;
                    n.isLast = isLast;
                    n.ancestorLines = ancestorLines;
                    n.statusInfo = resolveStatus(n, hoje);
                    if (!n.codigo || n.codigo === "-") {
                        n.codigo = level === 0 ? String(index + 1) : "";
                    }
                    flat.push(n);
                    flatten(n.children, level + 1, ancestorLines.concat([!isLast]));
                });
            }

            order(roots);
            roots.forEach(rollup);
            flatten(roots, 0, []);

            return {
                all: flat.filter(function (x) { return x.start && x.end; }),
                byId: map
            };
        }

        var normalized = normalizeTasks(tarefasBrutas || []);

        function isTimelineMode() {
            return timelineState.mode === "timeline";
        }

        function getTaskReferenceStart(task) {
            return task.start;
        }

        function getTaskReferenceEnd(task) {
            return task.end;
        }

        function isTaskStartedInTimeline(task) {
            if (!isTimelineMode()) { return true; }
            if (timelineState.awaitingStart) { return false; }
            var refStart = getTaskReferenceStart(task) || task.start;
            if (!refStart || !timelineState.simulatedDate) { return true; }
            return timelineState.simulatedDate >= refStart;
        }

        function getTimelineElapsedRatio() {
            if (!isTimelineMode() || !timelineState.projectStart || !timelineState.projectEnd || !timelineState.simulatedDate) {
                return 0;
            }

            var total = Math.max(diffDays(timelineState.projectStart, timelineState.projectEnd), 1);
            var elapsed = Math.max(0, diffDays(timelineState.projectStart, timelineState.simulatedDate));
            return Math.max(0, Math.min(1, elapsed / total));
        }

        function setupTimelineBounds(resetDate) {
            var base = normalized.all.filter(function (t) { return !t.hasChildren; });
            if (!base.length) { base = normalized.all.slice(); }

            var minStart = null;
            var maxEnd = null;

            base.forEach(function (t) {
                var refStart = getTaskReferenceStart(t);
                var refEnd = getTaskReferenceEnd(t);
                if (refStart && (!minStart || refStart < minStart)) { minStart = refStart; }
                if (refEnd && (!maxEnd || refEnd > maxEnd)) { maxEnd = refEnd; }
            });

            if (!minStart) { minStart = cloneDate(new Date()); }
            if (!maxEnd) { maxEnd = cloneDate(minStart); }
            if (maxEnd < minStart) { maxEnd = cloneDate(minStart); }

            timelineState.projectStart = cloneDate(minStart);
            timelineState.projectEnd = cloneDate(maxEnd);

            if (resetDate || !timelineState.simulatedDate) {
                timelineState.simulatedDate = cloneDate(timelineState.projectStart);
            } else {
                timelineState.simulatedDate = clampDate(timelineState.simulatedDate, timelineState.projectStart, timelineState.projectEnd);
            }
        }

        function clampDate(date, minDate, maxDate) {
            if (!date) { return cloneDate(minDate); }
            var d = cloneDate(date);
            if (d < minDate) { return cloneDate(minDate); }
            if (d > maxDate) { return cloneDate(maxDate); }
            return d;
        }

        function getTaskVisualState(task) {
            var baseVisual = {
                key: task.statusInfo.key,
                combinedKey: task.statusInfo.combinedKey,
                label: task.statusInfo.label,
                atrasado: task.statusInfo.atrasado,
                proximoVencimento: task.statusInfo.proximoVencimento,
                progress: task.progress,
                simulatedProgress: task.progress,
                playbackProgress: task.progress,
                timelineClass: "",
                countState: task.statusInfo.key
            };

            if (!isTimelineMode()) {
                return baseVisual;
            }

            var simDate = timelineState.simulatedDate || timelineState.projectStart;
            var simDay = cloneDate(simDate);
            var refStart = getTaskReferenceStart(task) || task.start;
            var refEnd = getTaskReferenceEnd(task) || task.end;

            if (timelineState.awaitingStart) {
                baseVisual.timelineClass = "g-sim-futura";
                baseVisual.countState = "futura";
                baseVisual.simulatedProgress = 0;
                baseVisual.playbackProgress = 0;
                return baseVisual;
            }

            if (task.statusInfo.key === "cancelado") {
                baseVisual.countState = "cancelado";
                return baseVisual;
            }

            if (!refStart || !refEnd) {
                return baseVisual;
            }

            if (simDay < refStart) {
                baseVisual.timelineClass = "g-sim-futura";
                baseVisual.countState = "futura";
                baseVisual.simulatedProgress = 0;
                baseVisual.playbackProgress = 0;
                return baseVisual;
            }

            if (simDay > refEnd) {
                baseVisual.timelineClass = "g-sim-concluida";
                baseVisual.countState = "concluida";
                baseVisual.simulatedProgress = 100;
                baseVisual.playbackProgress = task.statusInfo.key === "concluido"
                    ? Math.max(0, Math.min(100, task.progress))
                    : Math.max(0, Math.min(100, task.progress));
                return baseVisual;
            }

            var totalDuracao = Math.max(diffDays(refStart, refEnd) + 1, 1);
            var duracaoExecutada = Math.max(0, diffDaysPrecise(refStart, simDate));
            var progressoSimulado = Math.max(0, Math.min(100, Math.round((duracaoExecutada / totalDuracao) * 100)));

            baseVisual.timelineClass = "g-sim-andamento";
            baseVisual.countState = "andamento";
            baseVisual.simulatedProgress = progressoSimulado;
            baseVisual.playbackProgress = Math.max(0, Math.min(100, task.progress));
            return baseVisual;
        }

        function computeTimelineIndicators() {
            var tasks = getVisibleTasks();
            var done = 0;
            var running = 0;
            var future = 0;
            var totalPeso = 0;
            var totalProgress = 0;

            tasks.forEach(function (task) {
                var visual = getTaskVisualState(task);
                if (isTimelineMode()) {
                    if (!isTaskStartedInTimeline(task)) {
                        future++;
                    } else if (visual.key === "concluido") {
                        done++;
                    } else if (visual.key === "andamento") {
                        running++;
                    } else if (visual.key === "nao_iniciado") {
                        future++;
                    }
                } else {
                    if (visual.key === "concluido") { done++; }
                    else if (visual.key === "andamento") { running++; }
                    else if (visual.key === "nao_iniciado") { future++; }
                }

                if (visual.key === "cancelado") { return; }

                var refStart = getTaskReferenceStart(task) || task.start;
                var refEnd = getTaskReferenceEnd(task) || task.end;
                var peso = (refStart && refEnd) ? Math.max(diffDays(refStart, refEnd), 1) : 1;

                totalPeso += peso;
                totalProgress += visual.playbackProgress * peso;
            });

            return {
                done: done,
                running: running,
                future: future,
                progress: totalPeso ? Math.max(0, Math.min(100, Math.round(totalProgress / totalPeso))) : 0
            };
        }

        function updateTimelineIndicators() {
            var simDate = timelineState.simulatedDate || timelineState.projectStart;
            var indicadores = computeTimelineIndicators();

            $("#ganttTimelineDate").text(simDate ? formatDateBr(simDate) : "-");
            $("#ganttTimelineProgress").text(indicadores.progress + "%");
            $("#ganttTimelineProgressBar").css("width", indicadores.progress + "%");
            $("#ganttTimelineDone").text(indicadores.done);
            $("#ganttTimelineRunning").text(indicadores.running);
            $("#ganttTimelineFuture").text(indicadores.future);
        }

        function updateTimelineSpeedUi() {
            $("#ganttTimelineSpeeds [data-speed]").removeClass("is-active");
            $("#ganttTimelineSpeeds [data-speed='" + timelineState.speed + "']").addClass("is-active");
        }

        function stopTimelinePlayback() {
            timelineState.isPlaying = false;
            timelineState.lastTickAt = null;
            timelineState.lastRenderAt = null;
            timelineState.currentSpeed = 0;
            if (timelineState.tickTimer) {
                window.clearInterval(timelineState.tickTimer);
                timelineState.tickTimer = null;
            }
            if (timelineState.rafId) {
                window.cancelAnimationFrame(timelineState.rafId);
                timelineState.rafId = null;
            }
        }

        function renderTimelineFrame() {
            if ($("#grafico").hasClass("active")) {
                renderAll();
            } else {
                updateTimelineIndicators();
            }
        }

        function setTimelineDate(date) {
            if (!date) {
                timelineState.simulatedDate = clampDate(date, timelineState.projectStart, timelineState.projectEnd);
                return;
            }

            var t = date.getTime();
            var min = timelineState.projectStart.getTime();
            var max = timelineState.projectEnd.getTime() + (MS_PER_DAY - 1);
            if (t < min) { t = min; }
            if (t > max) { t = max; }
            timelineState.simulatedDate = new Date(t);
        }

        function tickTimeline(frameTime) {
            if (!timelineState.isPlaying) { return; }
            var now = typeof frameTime === "number" ? frameTime : Date.now();
            var last = timelineState.lastTickAt || now;
            var elapsedMs = Math.max(1, Math.min(120, now - last));
            timelineState.lastTickAt = now;

            var emInteracaoScroll = now < timelineState.userScrollActiveUntil;
            if (emInteracaoScroll) {
                timelineState.lastTickAt = now;

                if (timelineState.isPlaying) {
                    timelineState.rafId = window.requestAnimationFrame(tickTimeline);
                }
                return;
            }

            var alvo = Math.max(0.1, timelineState.speed);
            if (timelineState.currentSpeed <= 0) {
                timelineState.currentSpeed = Math.max(0.2, alvo * 0.22);
            }
            timelineState.currentSpeed += (alvo - timelineState.currentSpeed) * 0.16;

            var diasAvanco = (timelineState.currentSpeed * elapsedMs) / 1000;
            setTimelineDate(new Date(timelineState.simulatedDate.getTime() + (diasAvanco * MS_PER_DAY)));

            var chegouFim = false;
            if (timelineState.simulatedDate >= timelineState.projectEnd) {
                timelineState.simulatedDate = new Date(timelineState.projectEnd.getTime() + (MS_PER_DAY - 1));
                stopTimelinePlayback();
                chegouFim = true;
            }

            if ((!emInteracaoScroll && (!timelineState.lastRenderAt || (now - timelineState.lastRenderAt) >= 48)) || chegouFim) {
                timelineState.lastRenderAt = now;
                renderTimelineFrame();
            }

            if (timelineState.isPlaying) {
                timelineState.rafId = window.requestAnimationFrame(tickTimeline);
            }
        }

        function startTimelinePlayback() {
            if (timelineState.isPlaying) { return; }
            if (!timelineState.projectStart || !timelineState.projectEnd) { return; }

            if (timelineState.awaitingStart) {
                setTimelineDate(cloneDate(timelineState.projectStart));
            } else if (timelineState.simulatedDate && timelineState.simulatedDate >= timelineState.projectEnd) {
                setTimelineDate(cloneDate(timelineState.projectStart));
            }

            timelineState.awaitingStart = false;
            timelineState.isPlaying = true;
            timelineState.lastTickAt = null;
            timelineState.lastRenderAt = null;
            timelineState.currentSpeed = 0;
            timelineState.userScrollActiveUntil = 0;
            timelineState.suspendAutoScrollUntil = 0;
            timelineState.rafId = window.requestAnimationFrame(tickTimeline);
            renderTimelineFrame();
        }

        function ensureTimelineAutoScroll() {
            if (!isTimelineMode()) { return; }
            if (!timelineState.isPlaying) { return; }
            if (!timelineState.renderMetrics) { return; }
            if (Date.now() < timelineState.suspendAutoScrollUntil) { return; }
            if (Date.now() < timelineState.userScrollActiveUntil) { return; }

            var wrap = document.getElementById("ganttTimeWrap");
            if (!wrap) { return; }

            var offset = diffDaysPrecise(timelineState.renderMetrics.rangeStart, timelineState.simulatedDate) * timelineState.renderMetrics.dayWidth;
            var leftLimit = wrap.scrollLeft + 60;
            var rightLimit = wrap.scrollLeft + wrap.clientWidth - 60;

            if (offset >= leftLimit && offset <= rightLimit) { return; }

            var targetScrollLeft = Math.max(0, offset - (wrap.clientWidth * 0.35));
            if (Math.abs(targetScrollLeft - wrap.scrollLeft) < 8) { return; }
            timelineState.isAutoScrolling = true;

            wrap.scrollLeft = targetScrollLeft;

            window.setTimeout(function () {
                timelineState.isAutoScrolling = false;
            }, 80);
        }

        function updateTimelineModeUi() {
            var activeMode = timelineState.mode;
            $("#ganttViewToggle [data-view-mode]").removeClass("is-active");
            $("#ganttViewToggle [data-view-mode='" + activeMode + "']").addClass("is-active");
            $("#ganttTimelinePanel").toggle(activeMode === "timeline");
            updateTimelineSpeedUi();
        }

        setupTimelineBounds(true);

        function isDescendantCollapsed(node) {
            var p = node.parentId;
            while (p) {
                if (collapsed[p]) { return true; }
                var parent = normalized.byId[p];
                p = parent ? parent.parentId : null;
            }
            return false;
        }

        function getVisibleTasks() {
            return normalized.all.filter(function (t) {
                return !isDescendantCollapsed(t);
            });
        }

        function renderGrid(tasks) {
            var grid = document.getElementById("ganttGridBody");
            if (!grid) { return; }

            var frag = document.createDocumentFragment();

            tasks.forEach(function (task) {
                var visual = getTaskVisualState(task);
                var row = document.createElement("div");
                row.className = "gantt-grid-row g-level-" + Math.min(task.level, 1) + " g-row-status-" + visual.combinedKey + (visual.timelineClass ? " " + visual.timelineClass : "");
                row.setAttribute("data-id", task.id);

                var cCodigo = document.createElement("div");
                cCodigo.className = "g-cell";
                cCodigo.textContent = task.codigo || "-";
                row.appendChild(cCodigo);

                var cTipo = document.createElement("div");
                cTipo.className = "g-cell";
                var badge = document.createElement("span");
                badge.className = "g-tipo-badge " + tipoClass(task.tipo);
                badge.textContent = task.tipo || "-";
                cTipo.appendChild(badge);
                row.appendChild(cTipo);

                var cNome = document.createElement("div");
                cNome.className = "g-cell g-name";

                var indent = document.createElement("span");
                indent.className = "g-indent";
                indent.style.width = (task.level * 16) + "px";

                if (task.level > 0) {
                    (task.ancestorLines || []).forEach(function (showLine, i) {
                        if (showLine) {
                            var vline = document.createElement("span");
                            vline.className = "g-tree-line";
                            vline.style.left = (i * 16 + 7) + "px";
                            indent.appendChild(vline);
                        }
                    });

                    var elbow = document.createElement("span");
                    elbow.className = "g-tree-elbow" + (task.isLast ? " g-tree-elbow-last" : "");
                    elbow.style.left = ((task.level - 1) * 16 + 7) + "px";
                    indent.appendChild(elbow);
                }

                cNome.appendChild(indent);

                if (task.hasChildren) {
                    var togg = document.createElement("button");
                    togg.className = "mg-toggle";
                    togg.setAttribute("type", "button");
                    togg.setAttribute("data-id", task.id);
                    togg.textContent = collapsed[task.id] ? "+" : "\u2212";
                    cNome.appendChild(togg);
                } else if (visual.key === "cancelado") {
                    var dotCancel = document.createElement("span");
                    dotCancel.className = "mg-dot mg-dot-cancelado";
                    dotCancel.title = "Cancelado";
                    dotCancel.textContent = "\u00d7";
                    cNome.appendChild(dotCancel);
                } else {
                    var dot = document.createElement("span");
                    dot.className = "mg-dot";
                    cNome.appendChild(dot);
                }

                var nm = document.createElement("span");
                nm.className = "g-name-text" + (visual.key === "cancelado" ? " g-name-cancelado" : "");
                nm.textContent = task.nome;
                cNome.appendChild(nm);
                row.appendChild(cNome);

                row.setAttribute("data-tooltip", "1");

                var cIni = document.createElement("div");
                cIni.className = "g-cell g-cell-right";
                cIni.textContent = formatDateBr(task.start);
                row.appendChild(cIni);

                var cFim = document.createElement("div");
                cFim.className = "g-cell g-cell-right" + (visual.atrasado ? " g-cell-atrasado" : "");
                if (visual.atrasado) {
                    var flagIcon = document.createElement("span");
                    flagIcon.className = "g-grid-alert-flag";
                    flagIcon.title = "Atrasado";
                    flagIcon.textContent = "\u26a0";
                    cFim.appendChild(flagIcon);
                }
                cFim.appendChild(document.createTextNode(formatDateBr(task.end)));
                row.appendChild(cFim);

                var cPct = document.createElement("div");
                cPct.className = "g-cell g-cell-right";
                cPct.textContent = visual.progress + "%";
                row.appendChild(cPct);

                frag.appendChild(row);
            });

            grid.innerHTML = "";
            grid.appendChild(frag);
        }

        function computeRange(tasks) {
            var minStart = null;
            var maxEnd = null;

            tasks.forEach(function (t) {
                if (t.start && (!minStart || t.start < minStart)) { minStart = t.start; }
                if (t.end && (!maxEnd || t.end > maxEnd)) { maxEnd = t.end; }
            });

            if (!minStart) { minStart = new Date(); }
            if (!maxEnd) { maxEnd = new Date(); }

            minStart = addDays(minStart, -3);
            maxEnd = addDays(maxEnd, 3);

            if (diffDays(minStart, maxEnd) < 20) {
                maxEnd = addDays(minStart, 20);
            }

            return { start: cloneDate(minStart), end: cloneDate(maxEnd) };
        }

        function buildHeader(rangeStart, totalDays, dayWidth) {
            var headerEl = document.createElement("div");
            headerEl.className = "gantt-time-header";
            headerEl.style.width = (totalDays * dayWidth) + "px";

            var showYearRow = dayWidth < 10;
            var showDayRow = dayWidth >= 8;
            var showDayNumbers = dayWidth >= 8;
            var showMonthLabel = dayWidth * 28 >= 34;

            if (showYearRow) {
                var yearRow = document.createElement("div");
                yearRow.className = "g-year-row";

                var yIdx = 0;
                while (yIdx < totalDays) {
                    var yd = addDays(rangeStart, yIdx);
                    var yy2 = yd.getFullYear();
                    var ySpan = 0;

                    while (yIdx + ySpan < totalDays) {
                        var yyd = addDays(rangeStart, yIdx + ySpan);
                        if (yyd.getFullYear() !== yy2) { break; }
                        ySpan++;
                    }

                    var yearCell = document.createElement("div");
                    yearCell.className = "g-year-cell";
                    yearCell.style.left = (yIdx * dayWidth) + "px";
                    yearCell.style.width = (ySpan * dayWidth) + "px";
                    yearCell.textContent = String(yy2);
                    yearRow.appendChild(yearCell);

                    yIdx += ySpan;
                }

                headerEl.appendChild(yearRow);
            }

            var monthRow = document.createElement("div");
            monthRow.className = "g-month-row";

            var idx = 0;
            while (idx < totalDays) {
                var d = addDays(rangeStart, idx);
                var y = d.getFullYear();
                var m = d.getMonth();
                var span = 0;

                while (idx + span < totalDays) {
                    var dd = addDays(rangeStart, idx + span);
                    if (dd.getFullYear() !== y || dd.getMonth() !== m) { break; }
                    span++;
                }

                var monthCell = document.createElement("div");
                monthCell.className = "g-month-cell";
                monthCell.style.left = (idx * dayWidth) + "px";
                monthCell.style.width = (span * dayWidth) + "px";
                if (showMonthLabel) {
                    monthCell.textContent = showYearRow ? MONTH_NAMES[m].slice(0, 3) : (MONTH_NAMES[m] + "/" + y);
                }
                monthRow.appendChild(monthCell);

                idx += span;
            }

            headerEl.appendChild(monthRow);

            if (showDayRow) {
                var dayRow = document.createElement("div");
                dayRow.className = "g-day-row";

                for (var i = 0; i < totalDays; i++) {
                    var day = addDays(rangeStart, i);
                    var cell = document.createElement("div");
                    cell.className = "g-day-cell" + (isWeekend(day) ? " g-weekend-cell" : "");
                    cell.style.left = (i * dayWidth) + "px";
                    cell.style.width = dayWidth + "px";
                    if (showDayNumbers) { cell.textContent = day.getDate(); }
                    dayRow.appendChild(cell);
                }

                headerEl.appendChild(dayRow);
            } else {
                headerEl.classList.add("g-no-day-row");
            }

            return headerEl;
        }


        function buildHierarchyConnectors(tasks, rangeStart, dayWidth, totalWidth, totalHeight) {
            var svgNs = "http://www.w3.org/2000/svg";
            var svg = document.createElementNS(svgNs, "svg");
            svg.setAttribute("class", "g-hier-svg");
            svg.setAttribute("width", totalWidth);
            svg.setAttribute("height", totalHeight);

            var rowIndexById = {};
            tasks.forEach(function (t, idx) {
                rowIndexById[t.id] = idx;
            });

            var radius = 6;

            tasks.forEach(function (parent) {
                if (!parent.hasChildren) { return; }
                if (parent.level === 0) { return; }
                if (isTimelineMode() && !isTaskStartedInTimeline(parent)) { return; }

                var parentRowIdx = rowIndexById[parent.id];
                if (typeof parentRowIdx === "undefined") { return; }

                var visibleChildren = parent.children.filter(function (c) {
                    return typeof rowIndexById[c.id] !== "undefined";
                });
                if (isTimelineMode()) {
                    visibleChildren = visibleChildren.filter(function (c) { return isTaskStartedInTimeline(c); });
                }
                if (!visibleChildren.length) { return; }

                var parentStartOffset = diffDays(rangeStart, parent.start);
                var parentX = (parentStartOffset * dayWidth) + 6;
                var parentMidY = (parentRowIdx * ROW_HEIGHT) + (ROW_HEIGHT / 2);

                var lastChildRowIdx = rowIndexById[visibleChildren[visibleChildren.length - 1].id];
                var trunkBottomY = (lastChildRowIdx * ROW_HEIGHT) + (ROW_HEIGHT / 2);

                var trunk = document.createElementNS(svgNs, "path");
                var trunkD = "M " + parentX + " " + parentMidY + " V " + trunkBottomY;
                trunk.setAttribute("d", trunkD);
                trunk.setAttribute("class", "g-hier-path");
                svg.appendChild(trunk);

                visibleChildren.forEach(function (child) {
                    var childRowIdx = rowIndexById[child.id];
                    var childMidY = (childRowIdx * ROW_HEIGHT) + (ROW_HEIGHT / 2);
                    var childStartOffset = diffDays(rangeStart, child.start);
                    var childX = childStartOffset * dayWidth;

                    var branchWidth = Math.max(childX - parentX, radius * 2);
                    var r = Math.min(radius, branchWidth / 2, ROW_HEIGHT / 2);

                    var goingDown = childMidY > parentMidY;
                    var sweep = goingDown ? 1 : 0;
                    var vDir = goingDown ? 1 : -1;

                    var d = "M " + parentX + " " + (childMidY - (vDir * r))
                        + " Q " + parentX + " " + childMidY + " " + (parentX + r) + " " + childMidY
                        + " H " + childX;

                    var branch = document.createElementNS(svgNs, "path");
                    branch.setAttribute("d", d);
                    branch.setAttribute("class", "g-hier-path");
                    svg.appendChild(branch);
                });
            });

            return svg;
        }


        function buildRows(tasks, rangeStart, totalDays, dayWidth, totalWidth, totalHeight) {
            var rowsEl = document.createElement("div");
            rowsEl.className = "gantt-rows";
            rowsEl.style.width = totalWidth + "px";
            rowsEl.style.height = totalHeight + "px";

            var lineStep = dayWidth >= 8 ? 1 : 7;
            for (var i = 0; i < totalDays; i += lineStep) {
                var day = addDays(rangeStart, i);

                if (isWeekend(day) && dayWidth >= 4) {
                    var wknd = document.createElement("div");
                    wknd.className = "g-weekend";
                    wknd.style.left = (i * dayWidth) + "px";
                    wknd.style.width = dayWidth + "px";
                    rowsEl.appendChild(wknd);
                }

                var gline = document.createElement("div");
                gline.className = "g-grid-line";
                gline.style.left = (i * dayWidth) + "px";
                rowsEl.appendChild(gline);
            }

            if (isTimelineMode() && !timelineState.awaitingStart) {
                var offsetSimulado = diffDays(rangeStart, timelineState.simulatedDate);
                if (offsetSimulado >= 0 && offsetSimulado < totalDays) {
                    var simLine = document.createElement("div");
                    simLine.className = "g-simulated-line";
                    simLine.style.left = (offsetSimulado * dayWidth) + "px";
                    simLine.title = "Data simulada: " + formatDateBr(timelineState.simulatedDate);
                    rowsEl.appendChild(simLine);
                }
            } else {
                var hoje = cloneDate(new Date());
                var offsetHoje = diffDays(rangeStart, hoje);
                if (offsetHoje >= 0 && offsetHoje < totalDays) {
                    var todayLine = document.createElement("div");
                    todayLine.className = "g-today";
                    todayLine.style.left = (offsetHoje * dayWidth) + "px";
                    todayLine.title = "Hoje";
                    rowsEl.appendChild(todayLine);
                }
            }

            rowsEl.appendChild(buildHierarchyConnectors(tasks, rangeStart, dayWidth, totalWidth, totalHeight));

            tasks.forEach(function (task) {
                var visual = getTaskVisualState(task);
                var rowEl = document.createElement("div");
                rowEl.className = "gantt-time-row";
                rowEl.setAttribute("data-id", task.id);

                var startOffset = diffDays(rangeStart, task.start);

                if (task.marco) {
                    if (isTimelineMode() && visual.countState === "futura") {
                        rowsEl.appendChild(rowEl);
                        return;
                    }

                    var msLeft = (startOffset * dayWidth) + (dayWidth / 2) - 6;
                    var ms = document.createElement("div");
                    ms.className = "g-bar-milestone g-status-" + visual.combinedKey + (visual.timelineClass ? " " + visual.timelineClass : "");
                    ms.setAttribute("data-id", task.id);
                    ms.style.left = msLeft + "px";
                    rowEl.appendChild(ms);
                } else {
                    var durationDays = Math.max(diffDays(task.start, task.end) + 1, 1);
                    var barLeft = startOffset * dayWidth;
                    var minBarWidth = task.hasChildren ? 22 : 6;
                    var barWidth = Math.max((durationDays * dayWidth) - 2, minBarWidth);

                    if (isTimelineMode()) {
                        if (visual.countState === "futura") {
                            rowsEl.appendChild(rowEl);
                            return;
                        }
                    }

                    var isCancelado = visual.key === "cancelado";
                    var progressLabelValue = Math.max(0, Math.min(100, isTimelineMode() ? visual.playbackProgress : visual.progress));
                    var cancelamentoParcial = isCancelado && progressLabelValue > 0 && progressLabelValue < 100;

                    var bar = document.createElement("div");
                    var showVencimento = visual.proximoVencimento;
                    bar.className = "g-bar " + (task.hasChildren ? "g-bar-project" : "g-bar-task") + " g-status-" + visual.combinedKey + (showVencimento ? " g-bar-vencimento-proximo" : "") + (visual.timelineClass ? " " + visual.timelineClass : "") + (cancelamentoParcial ? " g-cancelamento-parcial" : "");
                    bar.setAttribute("data-id", task.id);
                    bar.style.left = barLeft + "px";
                    bar.style.width = barWidth + "px";

                    var progValue = progressLabelValue;
                    if (isCancelado && progValue === 0) {
                        progValue = 100;
                    }

                    var prog = document.createElement("div");
                    prog.className = "g-bar-progress" + (isCancelado ? " g-bar-progress-cancelado" : "");
                    prog.style.width = progValue + "%";

                    if (progressLabelValue > 0 && barWidth >= 34 && (!isTimelineMode() || visual.countState !== "futura")) {
                        var progLabel = document.createElement("span");
                        progLabel.className = "g-bar-progress-label";
                        progLabel.textContent = progressLabelValue + "%";
                        prog.appendChild(progLabel);
                    }

                    bar.appendChild(prog);

                    if (isTimelineMode() && visual.countState === "andamento") {
                        var revealPercent = Math.max(0, Math.min(100, visual.simulatedProgress));
                        var timelineMask = document.createElement("div");
                        timelineMask.className = "g-bar-timeline-mask";
                        timelineMask.style.left = revealPercent + "%";
                        bar.appendChild(timelineMask);
                    }

                    if (isCancelado && barWidth >= 16) {
                        var cancelIcon = document.createElement("span");
                        cancelIcon.className = "g-bar-cancel-icon";
                        cancelIcon.textContent = "\u00d7";
                        bar.appendChild(cancelIcon);
                    }

                    if (showVencimento && barWidth >= 16) {
                        var warningIcon = document.createElement("span");
                        warningIcon.className = "g-bar-warning-icon";
                        warningIcon.textContent = "\u26a0";
                        warningIcon.title = "Vencimento próximo";
                        bar.appendChild(warningIcon);
                    }

                    rowEl.appendChild(bar);

                    if (visual.atrasado) {
                        var flag = document.createElement("div");
                        flag.className = "g-alert-flag";
                        flag.style.left = (barLeft + barWidth + 4) + "px";
                        flag.title = "Atrasado";
                        rowEl.appendChild(flag);
                    }

                    if (showVencimento && !visual.atrasado && barWidth < 16) {
                        var warningFlag = document.createElement("div");
                        warningFlag.className = "g-warning-flag";
                        warningFlag.style.left = (barLeft + barWidth + 4) + "px";
                        warningFlag.title = "Vencimento próximo";
                        warningFlag.textContent = "\u26a0";
                        rowEl.appendChild(warningFlag);
                    }

                    var pessoas = task.pessoas || [];
                    var podeMostrarPessoas = !isTimelineMode() || visual.countState === "andamento" || visual.countState === "concluida";
                    if (pessoas.length) {
                        if (!podeMostrarPessoas) {
                            rowsEl.appendChild(rowEl);
                            return;
                        }

                        if (isTimelineMode() && visual.countState === "andamento" && barWidth < 26) {
                            rowsEl.appendChild(rowEl);
                            return;
                        }

                        var avatarLeft = barLeft + barWidth + ((visual.atrasado || visual.proximoVencimento) ? 20 : 4);
                        var stack = document.createElement("div");
                        stack.className = "g-people-stack";
                        stack.style.left = avatarLeft + "px";

                        var maxAvatares = 3;
                        pessoas.slice(0, maxAvatares).forEach(function (pessoa, idx) {
                            var avatar = document.createElement("div");
                            avatar.className = "g-people-avatar" + (pessoa.Responsavel ? " g-people-avatar-responsavel" : " g-people-avatar-integrante");
                            avatar.style.zIndex = String(maxAvatares - idx);
                            avatar.title = (pessoa.Nome || "") + (pessoa.Responsavel ? " (Responsável)" : " (Integrante)");

                            var iniciais = document.createElement("span");
                            iniciais.textContent = obterIniciais(pessoa.Nome);
                            avatar.appendChild(iniciais);

                            var badge = document.createElement("span");
                            badge.className = "g-people-badge";
                            badge.textContent = pessoa.Responsavel ? "R" : "I";
                            avatar.appendChild(badge);

                            stack.appendChild(avatar);
                        });

                        if (pessoas.length > maxAvatares) {
                            var extra = document.createElement("div");
                            extra.className = "g-people-avatar g-people-avatar-extra";
                            extra.title = (pessoas.length - maxAvatares) + " outro(s)";
                            extra.textContent = "+" + (pessoas.length - maxAvatares);
                            stack.appendChild(extra);
                        }

                        rowEl.appendChild(stack);
                    }
                }


                rowsEl.appendChild(rowEl);
            });

            return rowsEl;
        }

        function renderTimeline(tasks) {
            var inner = document.getElementById("ganttTimeInner");
            if (!inner) { return; }

            inner.innerHTML = "";
            timelineState.renderMetrics = null;

            if (!tasks.length) {
                inner.innerHTML = '<div class="mg-empty">Sem dados de tarefas para exibir no Gantt.</div>';
                return;
            }

            var range = computeRange(tasks);
            var totalDays = diffDays(range.start, range.end) + 1;
            var dayWidth = ZOOM_LEVELS[zoomIndex].dayWidth;
            var totalWidth = totalDays * dayWidth;
            var totalHeight = tasks.length * ROW_HEIGHT;

            timelineState.renderMetrics = {
                rangeStart: range.start,
                totalDays: totalDays,
                dayWidth: dayWidth,
                totalWidth: totalWidth
            };

            var header = buildHeader(range.start, totalDays, dayWidth);
            var rows = buildRows(tasks, range.start, totalDays, dayWidth, totalWidth, totalHeight);

            inner.style.width = totalWidth + "px";
            inner.appendChild(header);
            inner.appendChild(rows);

            if (!timelineState.isPlaying) {
                bindHoverSync();
            } else {
                hideTooltip();
            }
            bindScrollSync();
        }

        function getOrCreateTooltipEl() {
            var el = document.getElementById("ganttTooltip");
            if (!el) {
                el = document.createElement("div");
                el.id = "ganttTooltip";
                el.className = "g-tooltip";
                document.body.appendChild(el);
            }
            return el;
        }

        function obterIniciais(nome) {
            if (!nome) { return "?"; }
            var partes = nome.trim().split(/\s+/);
            if (partes.length === 1) { return partes[0].substring(0, 2).toUpperCase(); }
            return (partes[0].charAt(0) + partes[partes.length - 1].charAt(0)).toUpperCase();
        }

        function buildPessoaChipHtml(pessoa) {
            var avatarHtml = '<span class="g-people-chip-iniciais">' + escapeHtml(obterIniciais(pessoa.Nome)) + '</span>';

            return '<span class="g-people-chip g-people-chip-avatar' + (pessoa.Responsavel ? ' g-people-responsavel' : '') + '">'
                + '<span class="g-people-chip-foto">' + avatarHtml + '</span>'
                + '<span class="g-people-chip-nome">' + escapeHtml(pessoa.Nome || "") + '</span>'
                + '</span>';
        }

        function buildAvatarMiniHtml(pessoa) {
            var titulo = escapeHtml(pessoa.Nome || "");
            return '<span class="g-mini-avatar" title="' + titulo + '"><span class="g-mini-avatar-iniciais">' + escapeHtml(obterIniciais(pessoa.Nome)) + '</span></span>';
        }

        function buildEnvolvidosStackHtml(envolvidos) {
            var LIMITE_VISIVEL = 2;

            if (envolvidos.length <= LIMITE_VISIVEL) {
                return '<div class="g-tooltip-people g-tooltip-people-avatares">'
                    + envolvidos.map(buildPessoaChipHtml).join('')
                    + '</div>';
            }

            var visiveis = envolvidos.slice(0, LIMITE_VISIVEL);
            var restantes = envolvidos.slice(LIMITE_VISIVEL);

            return '<div class="g-mini-avatar-stack">'
                + visiveis.map(buildAvatarMiniHtml).join('')
                + '<span class="g-mini-avatar g-mini-avatar-extra" title="' + restantes.map(function (e) { return escapeHtml(e.Nome || ""); }).join(", ") + '">+' + restantes.length + '</span>'
                + '</div>';
        }

        function buildTooltipHtml(task) {
            var badgeClass = tipoClass(task.tipo);
            var visual = getTaskVisualState(task);
            var html = ''
                + '<div class="g-tooltip-header">'
                + '  <span class="g-tipo-badge ' + badgeClass + '">' + escapeHtml(task.tipo || "-") + '</span>'
                + '  <span class="g-tooltip-codigo">' + escapeHtml(task.codigo || "-") + '</span>'
                + '</div>'
                + '<div class="g-tooltip-title">' + escapeHtml(task.nome) + '</div>'
                + '<div class="g-tooltip-row"><span>Início:</span><b>' + formatDateBr(task.start) + '</b></div>'
                + '<div class="g-tooltip-row"><span>Fim:</span><b>' + formatDateBr(task.end) + '</b></div>'
                + '<div class="g-tooltip-row"><span>Progresso:</span><b>' + visual.progress + '%</b></div>';

            if (task.statusInfo && task.statusInfo.combinedKey === "concluido_atrasado" && task.dataEncerramento) {
                html += '<div class="g-tooltip-row"><span>Encerramento:</span><b>' + formatDateBr(task.dataEncerramento) + '</b></div>';
            }

            html += '<div class="g-tooltip-status g-tooltip-status-' + visual.combinedKey + '">' + visual.label + '</div>';

            var responsaveis = task.responsaveis || [];
            var integrantes = task.integrantes || [];

            var pessoas = task.pessoas || [];

            if (pessoas.length) {
                var pessoasResponsaveis = pessoas.filter(function (p) { return p.Responsavel; });
                var pessoasIntegrantes = pessoas.filter(function (p) { return !p.Responsavel; });

                html += '<div class="g-tooltip-section">';

                if (pessoasResponsaveis.length) {
                    html += '<div class="g-tooltip-section-title">Responsável' + (pessoasResponsaveis.length > 1 ? "eis" : "") + '</div>'
                        + '<div class="g-tooltip-people g-tooltip-people-avatares">'
                        + pessoasResponsaveis.map(buildPessoaChipHtml).join('')
                        + '</div>';
                }

                if (pessoasIntegrantes.length) {
                    html += '<div class="g-tooltip-section-title">Integrantes</div>'
                        + '<div class="g-tooltip-people g-tooltip-people-avatares">'
                        + pessoasIntegrantes.map(buildPessoaChipHtml).join('')
                        + '</div>';
                }

                html += '</div>';
            } else if (responsaveis.length || integrantes.length) {
                html += '<div class="g-tooltip-section">';

                if (responsaveis.length) {
                    html += '<div class="g-tooltip-section-title">Responsável' + (responsaveis.length > 1 ? "eis" : "") + '</div>'
                        + '<div class="g-tooltip-people">'
                        + responsaveis.map(function (nome) {
                            return '<span class="g-people-chip g-people-responsavel">' + escapeHtml(nome) + '</span>';
                        }).join('')
                        + '</div>';
                }

                if (integrantes.length) {
                    html += '<div class="g-tooltip-section-title">Integrantes</div>'
                        + '<div class="g-tooltip-people">'
                        + integrantes.map(function (nome) {
                            return '<span class="g-people-chip">' + escapeHtml(nome) + '</span>';
                        }).join('')
                        + '</div>';
                }

                html += '</div>';
            }

            var envolvidos = task.envolvidos || [];
            if (envolvidos.length) {
                html += '<div class="g-tooltip-section">'
                    + '<div class="g-tooltip-section-title">Envolvido' + (envolvidos.length > 1 ? "s" : "") + '</div>'
                    + buildEnvolvidosStackHtml(envolvidos)
                    + '</div>';
            }

            if (task.evidencia) {
                html += '<div class="g-tooltip-section">'
                    + '<div class="g-tooltip-section-title">Evidência</div>'
                    + '<div class="g-tooltip-evidencia">' + escapeHtml(task.evidencia) + '</div>'
                    + '</div>';
            }

            return html;
        }

        function showTooltip(task, evt) {
            var el = getOrCreateTooltipEl();
            el.innerHTML = buildTooltipHtml(task);
            el.style.display = "block";
            positionTooltip(el, evt);
        }

        function positionTooltip(el, evt) {
            var pad = 14;
            var x = evt.clientX + pad;
            var y = evt.clientY + pad;

            var rect = el.getBoundingClientRect();
            if (x + rect.width > window.innerWidth - 8) {
                x = evt.clientX - rect.width - pad;
            }
            if (y + rect.height > window.innerHeight - 8) {
                y = evt.clientY - rect.height - pad;
            }

            el.style.left = Math.max(4, x) + "px";
            el.style.top = Math.max(4, y) + "px";
        }

        function hideTooltip() {
            var el = document.getElementById("ganttTooltip");
            if (el) { el.style.display = "none"; }
        }

        function bindHoverSync() {
            var tooltipFixado = false;
            var tooltipIdAtual = null;

            function toggle(id, on) {
                var els = document.querySelectorAll('[data-id="' + id + '"]');
                Array.prototype.forEach.call(els, function (el) {
                    el.classList.toggle("g-hover", on);
                });
            }

            function limparHoverGlobal() {
                var els = document.querySelectorAll(".g-hover");
                Array.prototype.forEach.call(els, function (el) {
                    el.classList.remove("g-hover");
                });
            }

            function attachHover(selector, showTipOnHover) {
                var list = document.querySelectorAll(selector);
                Array.prototype.forEach.call(list, function (el) {
                    var id = el.getAttribute("data-id");
                    var task = normalized.byId[id];

                    el.addEventListener("mouseenter", function (evt) {
                        toggle(id, true);

                        if (showTipOnHover && task && (!tooltipFixado || tooltipIdAtual !== id)) {
                            showTooltip(task, evt);
                        }
                    });

                    el.addEventListener("mousemove", function (evt) {
                        if (!showTipOnHover) { return; }
                        if (tooltipFixado) { return; }
                        var tooltipEl = document.getElementById("ganttTooltip");
                        if (tooltipEl && tooltipEl.style.display === "block") {
                            positionTooltip(tooltipEl, evt);
                        }
                    });

                    el.addEventListener("mouseleave", function () {
                        if (!tooltipFixado || tooltipIdAtual !== id) {
                            toggle(id, false);
                            if (showTipOnHover) {
                                hideTooltip();
                            }
                        }
                    });
                });
            }

            function attachClickTooltip(selector) {
                var list = document.querySelectorAll(selector);
                Array.prototype.forEach.call(list, function (el) {
                    var id = el.getAttribute("data-id");
                    var task = normalized.byId[id];

                    el.addEventListener("click", function (evt) {
                        evt.stopPropagation();
                        if (!task) { return; }

                        if (tooltipFixado && tooltipIdAtual === id) {
                            tooltipFixado = false;
                            tooltipIdAtual = null;
                            hideTooltip();
                            toggle(id, false);
                            return;
                        }

                        limparHoverGlobal();
                        toggle(id, true);
                        showTooltip(task, evt);
                        tooltipFixado = true;
                        tooltipIdAtual = id;
                    });
                });
            }

            attachHover("#ganttTimeInner .g-bar[data-id]", true);
            attachHover("#ganttTimeInner .g-bar-milestone[data-id]", true);

            attachClickTooltip("#ganttTimeInner .g-bar[data-id]");

            document.addEventListener("click", function () {
                if (!tooltipFixado) { return; }
                tooltipFixado = false;
                tooltipIdAtual = null;
                hideTooltip();
                limparHoverGlobal();
            });
        }


        function bindScrollSync() {
            var wrap = document.getElementById("ganttTimeWrap");
            var gridBody = document.getElementById("ganttGridBody");
            if (!wrap || !gridBody) { return; }
            var syncingFromWrap = false;
            var syncingFromGrid = false;

            function getScrollRatio(el) {
                if (!el) { return 0; }
                var max = Math.max(0, el.scrollHeight - el.clientHeight);
                if (!max) { return 0; }
                return Math.max(0, Math.min(1, el.scrollTop / max));
            }

            function applyScrollRatio(el, ratio) {
                if (!el) { return; }
                var max = Math.max(0, el.scrollHeight - el.clientHeight);
                var clamped = Math.max(0, Math.min(1, ratio || 0));
                var next = Math.round(max * clamped);
                if (el.scrollTop !== next) {
                    el.scrollTop = next;
                }
            }

            function markUserScrollInteraction() {
                if (!isTimelineMode() || timelineState.isAutoScrolling || timelineState.isRestoringViewport) { return; }
                if (Date.now() < timelineState.suppressScrollMarkUntil) { return; }
                var now = Date.now();
                timelineState.userScrollActiveUntil = now + 350;
                timelineState.suspendAutoScrollUntil = now + 1400;
            }

            wrap.onwheel = function () {
                markUserScrollInteraction();
            };

            wrap.onmousedown = function () {
                markUserScrollInteraction();
            };

            wrap.onkeydown = function () {
                markUserScrollInteraction();
            };

            gridBody.onwheel = function () {
                markUserScrollInteraction();
            };

            gridBody.onmousedown = function () {
                markUserScrollInteraction();
            };

            gridBody.onkeydown = function () {
                markUserScrollInteraction();
            };

            wrap.onscroll = function () {
                if (syncingFromGrid) { return; }
                syncingFromWrap = true;
                var wrapRatio = getScrollRatio(wrap);
                applyScrollRatio(gridBody, wrapRatio);
                syncingFromWrap = false;
                timelineState.lastViewportRatio = wrapRatio;

                if (timelineState.isRestoringViewport) { return; }
                if (isTimelineMode() && timelineState.isPlaying && !timelineState.isAutoScrolling) {
                    var now = Date.now();
                    if (now < timelineState.suppressScrollMarkUntil) { return; }
                    timelineState.userScrollActiveUntil = now + 350;
                    timelineState.suspendAutoScrollUntil = now + 1400;
                }
            };

            gridBody.onscroll = function () {
                if (syncingFromWrap) { return; }
                syncingFromGrid = true;
                var gridRatio = getScrollRatio(gridBody);
                applyScrollRatio(wrap, gridRatio);
                syncingFromGrid = false;
                timelineState.lastViewportRatio = gridRatio;

                if (timelineState.isRestoringViewport) { return; }
                if (isTimelineMode() && timelineState.isPlaying && !timelineState.isAutoScrolling) {
                    var now = Date.now();
                    if (now < timelineState.suppressScrollMarkUntil) { return; }
                    timelineState.userScrollActiveUntil = now + 350;
                    timelineState.suspendAutoScrollUntil = now + 1400;
                }
            };
        }

        function captureViewport() {
            var wrap = document.getElementById("ganttTimeWrap");
            var gridBody = document.getElementById("ganttGridBody");

            var wrapMax = wrap ? Math.max(0, wrap.scrollHeight - wrap.clientHeight) : 0;
            var gridMax = gridBody ? Math.max(0, gridBody.scrollHeight - gridBody.clientHeight) : 0;
            var wrapRatio = (wrap && wrapMax) ? (wrap.scrollTop / wrapMax) : 0;
            var gridRatio = (gridBody && gridMax) ? (gridBody.scrollTop / gridMax) : 0;
            var verticalRatio = 0;
            if (wrap && gridBody) {
                var wrapTop = wrap.scrollTop || 0;
                var gridTop = gridBody.scrollTop || 0;
                if (gridTop > wrapTop + 2) {
                    verticalRatio = gridRatio;
                } else if (wrapTop > gridTop + 2) {
                    verticalRatio = wrapRatio;
                } else {
                    verticalRatio = (wrapRatio + gridRatio) / 2;
                }
            } else if (wrap) {
                verticalRatio = wrapRatio;
            } else {
                verticalRatio = gridRatio;
            }

            if (!isFinite(verticalRatio) || verticalRatio < 0) {
                verticalRatio = timelineState.lastViewportRatio || 0;
            }
            timelineState.lastViewportRatio = Math.max(0, Math.min(1, verticalRatio));

            return {
                hasViewport: !!(wrap || gridBody),
                timeScrollTop: wrap ? wrap.scrollTop : 0,
                timeScrollLeft: wrap ? wrap.scrollLeft : 0,
                gridScrollTop: gridBody ? gridBody.scrollTop : 0,
                verticalRatio: timelineState.lastViewportRatio
            };
        }

        function restoreViewport(viewport) {
            if (!viewport || !viewport.hasViewport) { return; }

            var wrap = document.getElementById("ganttTimeWrap");
            var gridBody = document.getElementById("ganttGridBody");
            var vertical = viewport.timeScrollTop || viewport.gridScrollTop || 0;
            var verticalRatio = Math.max(0, Math.min(1, viewport.verticalRatio || 0));

            timelineState.isRestoringViewport = true;
            timelineState.suppressScrollMarkUntil = Date.now() + 160;

            try {
                if (wrap) {
                    var nextLeft = viewport.timeScrollLeft || 0;
                    var wrapMax = Math.max(0, wrap.scrollHeight - wrap.clientHeight);
                    var nextVertical = wrapMax ? Math.round(wrapMax * verticalRatio) : vertical;
                    if (wrap.scrollLeft !== nextLeft) { wrap.scrollLeft = nextLeft; }
                    if (wrap.scrollTop !== nextVertical) { wrap.scrollTop = nextVertical; }
                }

                if (gridBody) {
                    var gridMax = Math.max(0, gridBody.scrollHeight - gridBody.clientHeight);
                    var nextGridVertical = gridMax ? Math.round(gridMax * verticalRatio) : vertical;
                    if (gridBody.scrollTop !== nextGridVertical) { gridBody.scrollTop = nextGridVertical; }
                }
            } finally {
                timelineState.isRestoringViewport = false;
            }
        }

        function renderAll() {
            var host = document.getElementById("chartDivGantt");
            if (!host) { return; }
            var viewport = captureViewport();
            var hostClasses = [];
            if (isTimelineMode()) {
                hostClasses.push("is-timeline-mode");
                if (getTimelineElapsedRatio() <= 0.12) {
                    hostClasses.push("is-timeline-birth");
                }
            }
            host.className = hostClasses.join(" ");

            host.innerHTML = ''
                + '<div class="gantt-shell">'
                + '  <div class="gantt-grid">'
                + '    <div class="gantt-grid-header">'
                + '      <div class="g-cell">Nível</div>'
                + '      <div class="g-cell">Tipo</div>'
                + '      <div class="g-cell">Atividade</div>'
                + '      <div class="g-cell g-cell-right">Início</div>'
                + '      <div class="g-cell g-cell-right">Fim</div>'
                + '      <div class="g-cell g-cell-right">%</div>'
                + '    </div>'
                + '    <div class="gantt-grid-body" id="ganttGridBody"></div>'
                + '  </div>'
                + '  <div class="gantt-time-wrap" id="ganttTimeWrap">'
                + '    <div class="gantt-time-inner" id="ganttTimeInner"></div>'
                + '  </div>'
                + '</div>';

            applyChartScale();

            var visible = getVisibleTasks();
            renderGrid(visible);
            applyGridLayoutByZoom();
            renderTimeline(visible);
            bindGridEvents();
            updateZoomLabel();
            updateTimelineIndicators();
            updateTimelineModeUi();
            updateChartScaleUi();

            restoreViewport(viewport);
            ensureTimelineAutoScroll();

            renderedOnce = true;
        }

        function bindGridEvents() {
            $("#ganttGridBody .mg-toggle").off("click").on("click", function () {
                var id = $(this).data("id");
                collapsed[id] = !collapsed[id];
                renderAll();
            });
        }

        function setZoom(delta) {
            zoomIndex += delta;
            if (zoomIndex < 0) { zoomIndex = 0; }
            if (zoomIndex >= ZOOM_LEVELS.length) { zoomIndex = ZOOM_LEVELS.length - 1; }
            renderAll();
        }

        function updateZoomLabel() {
            var el = document.getElementById("ganttZoomLabel");
            if (el) { el.textContent = ZOOM_LEVELS[zoomIndex].label; }
        }

        function applyChartScale() {
            var host = document.getElementById("chartDivGantt");
            if (!host) { return; }

            var shell = host.querySelector(".gantt-shell");
            if (!shell) { return; }

            var zoomValue = Math.max(70, Math.min(100, chartScalePercent)) / 100;
            shell.style.zoom = String(zoomValue);
        }

        function updateChartScaleUi() {
            $("#ganttScaleControls [data-chart-scale]").removeClass("is-active");
            $("#ganttScaleControls [data-chart-scale='" + chartScalePercent + "']").addClass("is-active");
        }

        function applyGridLayoutByZoom() {
            var host = document.getElementById("chartDivGantt");
            if (!host) { return; }

            var grid = host.querySelector(".gantt-grid");
            if (!grid) { return; }

            var layout = GRID_LAYOUT_BY_ZOOM[zoomIndex] || GRID_LAYOUT_BY_ZOOM[0];
            if (!layout) { return; }

            var template = layout.cols.map(function (c) {
                return typeof c === "number" ? (c + "px") : c;
            }).join(" ");

            grid.style.width = layout.width + "px";
            grid.style.minWidth = layout.width + "px";
            grid.style.flex = "0 0 " + layout.width + "px";

            var lineEls = grid.querySelectorAll(".gantt-grid-header, .gantt-grid-row");
            Array.prototype.forEach.call(lineEls, function (line) {
                line.style.gridTemplateColumns = template;
            });
        }

        function computeAutoZoomIndex(tasks) {
            var range = computeRange(tasks);
            var totalDays = diffDays(range.start, range.end) + 1;

            if (totalDays <= 90) { return 0; }
            if (totalDays <= 240) { return 1; }
            if (totalDays <= 540) { return 2; }
            if (totalDays <= 1460) { return 3; }
            return 4;
        }

        function setTimelineMode(mode) {
            if (mode !== "gantt" && mode !== "timeline") { return; }
            timelineState.mode = mode;
            if (mode !== "timeline") {
                stopTimelinePlayback();
            } else {
                timelineState.awaitingStart = true;
                setTimelineDate(cloneDate(timelineState.projectStart));
            }

            renderIfVisible();
            updateTimelineModeUi();
        }

        function initViewModeToggle() {
            $("#ganttViewToggle [data-view-mode]").off("click").on("click", function () {
                var mode = $(this).data("view-mode");
                setTimelineMode(mode);
            });
        }

        function initTimelineControls() {
            $("#ganttTimelinePanel [data-timeline-action]").off("click").on("click", function () {
                var action = $(this).data("timeline-action");

                if (action === "play") {
                    startTimelinePlayback();
                } else if (action === "pause") {
                    stopTimelinePlayback();
                } else if (action === "restart") {
                    stopTimelinePlayback();
                    timelineState.awaitingStart = true;
                    setTimelineDate(timelineState.projectStart);
                    renderTimelineFrame();
                } else if (action === "finish") {
                    stopTimelinePlayback();
                    timelineState.awaitingStart = false;
                    setTimelineDate(timelineState.projectEnd);
                    renderTimelineFrame();
                }
            });

            $("#ganttTimelineSpeeds [data-speed]").off("click").on("click", function () {
                var speed = parseInt($(this).data("speed"), 10);
                if (TIMELINE_SPEEDS.indexOf(speed) < 0) { return; }
                timelineState.speed = speed;
                updateTimelineSpeedUi();
                timelineState.lastTickAt = Date.now();
            });
        }

        function initToolbar() {
            $("#ganttToolbar [data-action]").off("click").on("click", function () {
                var action = $(this).data("action");
                if (action === "expand-all") {
                    collapsed = {};
                    renderAll();
                } else if (action === "collapse-all") {
                    collapsed = {};
                    normalized.all.forEach(function (t) {
                        if (t.hasChildren) { collapsed[t.id] = true; }
                    });
                    renderAll();
                } else if (action === "zoom-in") {
                    setZoom(-1);
                } else if (action === "zoom-out") {
                    setZoom(1);
                } else if (action === "zoom-reset") {
                    zoomIndex = computeAutoZoomIndex(normalized.all);
                    renderAll();
                }
            });

            $("#ganttScaleControls [data-chart-scale]").off("click").on("click", function () {
                var scale = parseInt($(this).data("chart-scale"), 10);
                if (CHART_SCALE_PRESETS.indexOf(scale) < 0) { return; }
                chartScalePercent = scale;
                updateChartScaleUi();
                applyChartScale();
            });
        }

        function renderIfVisible() {
            if ($("#grafico").hasClass("active")) {
                if (!renderedOnce) {
                    zoomIndex = computeAutoZoomIndex(normalized.all);
                    chartScalePercent = 100;
                }
                renderAll();
                initToolbar();
            }
        }

        function refreshFromServer() {
            var url = $("#ganttRefreshUrl").val();
            if (!url) { return; }

            $.ajax({
                url: url,
                type: "GET",
                cache: false,
                success: function (result) {
                    tarefasBrutas = result || [];
                    normalized = normalizeTasks(tarefasBrutas || []);
                    setupTimelineBounds(false);

                    if (!renderedOnce) {
                        zoomIndex = computeAutoZoomIndex(normalized.all);
                    }

                    renderIfVisible();
                }
            });
        }

        function initSignalR() {
            if (!$.connection || !$.connection.hub) { return; }

            function scheduleRefresh() {
                if (signalrRefreshTimer) { window.clearTimeout(signalrRefreshTimer); }
                signalrRefreshTimer = window.setTimeout(function () {
                    refreshFromServer();
                }, 250);
            }

            if ($.connection.monitoramentoProjetoHub) {
                $.connection.monitoramentoProjetoHub.client.getMonitoramento = scheduleRefresh;
            }

            if ($.connection.monitoramentoHub) {
                $.connection.monitoramentoHub.client.getMonitoramento = scheduleRefresh;
            }

            if ($.connection.hub.state === $.signalR.connectionState.disconnected) {
                $.connection.hub.start();
            }
        }

        $('a[href="#grafico"]').on("shown.bs.tab", function () {
            renderIfVisible();
        });

        $(window).on("resize", function () {
            if (!renderedOnce) { return; }
            if (resizeTimer) { window.clearTimeout(resizeTimer); }
            resizeTimer = window.setTimeout(function () {
                renderIfVisible();
            }, 180);
        });

        initViewModeToggle();
        initTimelineControls();
        updateTimelineModeUi();
        updateTimelineIndicators();
        initSignalR();
        renderIfVisible();
    });
})();
