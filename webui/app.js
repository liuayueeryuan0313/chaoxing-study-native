// 超星学习控制台前端逻辑
(() => {
  'use strict';

  // 状态维护
  const state = {
    snapshot: null,
    selectedKeys: new Set(),
    filter: 'all',
    searchQuery: '',
    expandedChapters: new Set(),
    collapsedGroups: new Set(),
    logs: [],
    maxLogs: 300,
    drawerOpen: true,
    activeTab: 'logs'
  };

  // DOM 元素引用
  const el = {
    connectionStatus: document.getElementById('connectionStatus'),
    nasUserBadge: document.getElementById('nasUserBadge'),
    appModeBadge: document.getElementById('appModeBadge'),
    phaseIndicator: document.getElementById('phaseIndicator'),
    phaseName: document.getElementById('phaseName'),
    btnInit: document.getElementById('btnInit'),
    btnStart: document.getElementById('btnStart'),
    btnPause: document.getElementById('btnPause'),
    btnResume: document.getElementById('btnResume'),
    btnStop: document.getElementById('btnStop'),
    btnScan: document.getElementById('btnScan'),
    rateSelect: document.getElementById('rateSelect'),
    studyModeSelect: document.getElementById('studyModeSelect'),
    maxTasksInput: document.getElementById('maxTasksInput'),
    alertBanner: document.getElementById('alertBanner'),
    alertMessage: document.getElementById('alertMessage'),
    alertClose: document.getElementById('alertClose'),
    
    // 指标卡片
    statCompletionPercent: document.getElementById('statCompletionPercent'),
    statCompletionBar: document.getElementById('statCompletionBar'),
    statCompletionHint: document.getElementById('statCompletionHint'),
    statMediaHint: document.getElementById('statMediaHint'),
    statClassificationHint: document.getElementById('statClassificationHint'),
    statVideoRatio: document.getElementById('statVideoRatio'),
    statMediaPercent: document.getElementById('statMediaPercent'),
    statMediaBar: document.getElementById('statMediaBar'),
    statDurationRatio: document.getElementById('statDurationRatio'),
    pillPassed: document.getElementById('pillPassed'),
    pillPending: document.getElementById('pillPending'),
    pillManual: document.getElementById('pillManual'),
    pillFailed: document.getElementById('pillFailed'),
    pillUnverified: document.getElementById('pillUnverified'),
    activeTaskTitle: document.getElementById('activeTaskTitle'),
    activeTaskTime: document.getElementById('activeTaskTime'),
    activeProgressBar: document.getElementById('activeProgressBar'),
    activeRateBadge: document.getElementById('activeRateBadge'),
    activeTaskChapter: document.getElementById('activeTaskChapter'),

    // 课程侧边栏
    courseCountBadge: document.getElementById('courseCountBadge'),
    coursesList: document.getElementById('coursesList'),
    btnSelectAll: document.getElementById('btnSelectAll'),
    btnDeselectAll: document.getElementById('btnDeselectAll'),

    // 任务树
    treeContainer: document.getElementById('treeContainer'),
    taskSearchInput: document.getElementById('taskSearchInput'),
    filterTabs: document.querySelectorAll('.filter-tab'),
    btnExpandAll: document.getElementById('btnExpandAll'),
    btnCollapseAll: document.getElementById('btnCollapseAll'),

    // 底部抽屉
    bottomDrawer: document.getElementById('bottomDrawer'),
    drawerToggle: document.getElementById('drawerToggle'),
    drawerBody: document.getElementById('drawerBody'),
    btnCollapseDrawer: document.getElementById('btnCollapseDrawer'),
    logCountPill: document.getElementById('logCountPill'),
    logStream: document.getElementById('logStream'),
    btnClearLogs: document.getElementById('btnClearLogs'),
    drawerTabs: document.querySelectorAll('.drawer-tab'),
    tabPanes: document.querySelectorAll('.tab-pane'),
    
    btnRefreshVnc: document.getElementById('btnRefreshVnc')
  };

  // 格式化秒数为 mm:ss 或 hh:mm:ss
  function formatSeconds(sec) {
    if (sec == null || !Number.isFinite(sec)) return '--:--';
    const s = Math.floor(sec);
    const m = Math.floor(s / 60);
    const rSec = s % 60;
    if (m >= 60) {
      const h = Math.floor(m / 60);
      const rm = m % 60;
      return `${h}:${String(rm).padStart(2, '0')}:${String(rSec).padStart(2, '0')}`;
    }
    return `${String(m).padStart(2, '0')}:${String(rSec).padStart(2, '0')}`;
  }

  // 阶段显示字典
  const phaseMap = {
    idle: { label: '空闲', class: '' },
    logging_in: { label: '等待扫码登录', class: 'phase-running' },
    awaiting_verification: { label: '等待输入验证码', class: 'phase-paused' },
    verifying: { label: '正在提交本人验证', class: 'phase-running' },
    ready: { label: '就绪', class: '' },
    scanning: { label: '正在扫描章节', class: 'phase-running' },
    running: { label: '学习中', class: 'phase-running' },
    pausing: { label: '正在暂停...', class: 'phase-paused' },
    paused: { label: '已暂停', class: 'phase-paused' },
    stopping: { label: '正在停止...', class: 'phase-paused' },
    stopped: { label: '已停止', class: '' },
    completed: { label: '队列学习完成', class: 'phase-completed' },
    failed: { label: '异常', class: 'phase-failed' },
    closed: { label: '已关闭', class: '' }
  };

  // 任务状态字典
  const statusMap = {
    passed: { label: '已通过', cls: 'status-badge-passed' },
    playing: { label: '学习中', cls: 'status-badge-playing' },
    paused: { label: '已暂停', cls: 'status-badge-paused' },
    pending: { label: '待学习', cls: 'status-badge-pending' },
    needs_verification: { label: '待核对', cls: 'status-badge-needs_verification' },
    manual: { label: '需手动', cls: 'status-badge-manual' },
    resource: { label: '资料（非任务点）', cls: 'status-badge-pending' },
    failed: { label: '失败', cls: 'status-badge-failed' }
  };

  // API 请求函数
  async function api(endpoint, body = null, method = 'POST') {
    try { return await window.cxNative.request(endpoint, body, method); }
    catch (error) { showAlert(error.message, true); throw error; }
  }

  function showAlert(message, isError = false) {
    el.alertMessage.textContent = message;
    el.alertBanner.className = `alert-banner ${isError ? 'alert-error' : ''}`;
  }

  function hideAlert() {
    el.alertBanner.className = 'alert-banner hidden';
  }

  el.alertClose.addEventListener('click', hideAlert);

  // SSE 实时连接
  function initSSE() {
    const sse = new EventSource('./api/events');

    sse.onopen = () => {
      el.connectionStatus.className = 'connection-status online';
      el.connectionStatus.querySelector('.status-text').textContent = '已连接';
    };

    sse.onerror = () => {
      el.connectionStatus.className = 'connection-status';
      el.connectionStatus.querySelector('.status-text').textContent = '断线重连中';
    };

    sse.addEventListener('message', e => {
      try {
        const native = JSON.parse(e.data);
        const snap = window.cxNative.snapshot(native);
        state.logs = native.logs.map(l => ({time:l.at, event:'info', data:{message:l.message}})).slice(-state.maxLogs);
        renderLogs();
        renderSnapshot(snap);
      } catch (err) {
        console.error('快照解析失败', err);
      }
    });

    sse.addEventListener('log', e => {
      try {
        const log = JSON.parse(e.data);
        appendLog(log);
      } catch (_) {}
    });
    sse.addEventListener('operation-error', e => {
      try { const { error } = JSON.parse(e.data); showAlert(`[${error.code}] ${error.message}`, true); } catch (_) {}
    });

    sse.addEventListener('recent_logs', e => {
      try {
        const logs = JSON.parse(e.data);
        state.logs = logs.slice(-state.maxLogs);
        renderLogs();
      } catch (_) {}
    });
  }

  // 追加日志
  function appendLog(item) {
    state.logs.push(item);
    if (state.logs.length > state.maxLogs) state.logs.shift();
    renderLogs();
  }

  function renderLogs() {
    const previousTop = el.logStream.scrollTop;
    const followLatest = el.logStream.scrollHeight - el.logStream.clientHeight - previousTop <= 32;
    el.logCountPill.textContent = `${state.logs.length} 条`;
    el.logStream.innerHTML = state.logs.map(log => {
      const timeStr = log.time ? new Date(log.time).toLocaleTimeString() : new Date().toLocaleTimeString();
      const isErr = log.event?.includes('error') || log.event?.includes('fail');
      let msg = '';
      if (log.data) {
        if (typeof log.data === 'string') msg = log.data;
        else if (log.data.message) msg = log.data.message;
        else if (log.data.text) msg = log.data.text;
        else msg = JSON.stringify(log.data);
      }
      return `<div class="log-line ${isErr ? 'log-err' : ''}">
        <span class="log-time">[${timeStr}]</span>
        <span class="log-tag">${escapeHtml(log.event || 'info')}:</span>
        <span class="log-msg">${escapeHtml(msg)}</span>
      </div>`;
    }).join('');
    el.logStream.scrollTop = followLatest ? el.logStream.scrollHeight : previousTop;
  }

  el.btnClearLogs.addEventListener('click', () => {
    state.logs = [];
    renderLogs();
  });

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // 核心渲染逻辑
  function renderSnapshot(snap) {
    state.snapshot = snap;
    const user = snap.gatewayUser;
    el.nasUserBadge.hidden = !user;
    if (user) {
      el.nasUserBadge.textContent = `${user.username || `UID ${user.uid}`} · 独立空间`;
      el.nasUserBadge.title = `飞牛用户 UID ${user.uid}：账号、课程、进度、日志和任务控制仅属于当前用户。`;
    }

    // 1. 顶栏阶段指示器
    const phaseInfo = phaseMap[snap.phase] || { label: snap.phase, class: '' };
    el.phaseName.textContent = phaseInfo.label;
    el.phaseIndicator.className = `phase-indicator ${phaseInfo.class}`;

    // 2. 按钮控制联动（严格按照 snap.controls 属性）
    const c = snap.controls || {};
    el.btnInit.disabled = !c.canInitialize;
    el.btnStart.disabled = !c.canStart;
    el.btnPause.disabled = !c.canPause;
    el.btnResume.disabled = !c.canResume;
    el.btnStop.disabled = !c.canStop;
    el.btnScan.disabled = !c.canScan;
    document.getElementById('forceRescan').disabled = snap.busy;
    el.studyModeSelect.disabled = snap.busy;
    el.rateSelect.disabled = snap.busy;
    el.maxTasksInput.disabled = snap.busy;

    // 3. 错误 / 提示横幅
    if (snap.lastError) {
      showAlert(`[${snap.lastError.code || '错误'}] ${snap.lastError.message}`, true);
    } else if (snap.phase === 'logging_in') {
      showAlert('请打开扫码登录窗口，用学习通 App 扫码确认。', false);
    } else if (snap.lastResult?.stopped) {
      showAlert('队列已停止；下次将从平台确认的断点续接。', false);
    }

    if (!snap.lastError && ['ready', 'running', 'completed', 'scanning', 'verifying'].includes(snap.phase)) hideAlert();
    window.cxLoginPanel?.phase(snap.phase,snap.qrReady);
    window.cxVerificationPanel?.update(snap.requiresVerification,snap.busy,snap.lastError,snap.verification);

    // 4. 指标概览
    const o = snap.overall || {
      videoTotal: 0, videoPassed: 0, videoPending: 0, manualTasks: 0, failedTasks: 0,
      completionPercent: null, mediaPercent: null, progressMediaSeconds: 0, knownDurationSeconds: 0
    };

    el.statCompletionPercent.textContent = o.taskTotal > 0 && o.unverifiedTasks === o.taskTotal ? '待核对' : o.completionPercent != null ? `${o.unverifiedTasks ? '已确认 ' : ''}${o.completionPercent}%` : '--%';
    el.statCompletionBar.style.width = `${o.completionPercent || 0}%`;
    el.statVideoRatio.textContent = `${o.taskPassed} / ${o.taskTotal} 任务`;

    el.statMediaPercent.textContent = o.mediaPercent != null ? `${o.mediaComplete ? '' : '已知 '}${o.mediaPercent}%` : '--%';
    el.statMediaBar.style.width = `${o.mediaPercent || 0}%`;
    el.statDurationRatio.textContent = `${formatSeconds(o.progressMediaSeconds)} / ${formatSeconds(o.knownDurationSeconds)}`;
    el.statCompletionHint.textContent = !snap.selectedCourseKeys?.length ? '请先选择课程并扫描章节' : !o.inventoryComplete ? '目录尚未完整读取，当前统计已读取的任务' : o.unverifiedTasks ? `还有 ${o.unverifiedTasks} 项待核对，未当作未完成或已完成` : `已核对全部 ${o.taskTotal} 项任务；完成以平台确认为准`;
    const mediaNotes = [];
    if (o.unknownDurationVideos) mediaNotes.push(`${o.unknownDurationVideos} 个视频时长待获取，当前仅计已知时长`);
    if (o.unknownPositionVideos) mediaNotes.push(`${o.unknownPositionVideos} 个视频的保存位置未知`);
    if (!o.inventoryComplete) mediaNotes.push('目录尚未完整读取');
    if (o.unverifiedTasks) mediaNotes.push('部分状态待核对');
    el.statMediaHint.textContent = mediaNotes.join('；') || (o.hasLiveEstimate ? '包含当前视频的实时估算；不是完成证明' : `按全部 ${o.videoTotal} 个任务视频的时长与平台位置计算`);
    el.statClassificationHint.textContent = `已读取 ${o.taskTotal} 项任务；${o.resourceTotal || 0} 项参考资料不计入；各分类不重复`;

    el.pillPassed.textContent = o.taskPassed;
    el.pillPending.textContent = o.taskPending;
    el.pillManual.textContent = o.manualTasks;
    el.pillFailed.textContent = o.failedTasks;
    el.pillUnverified.textContent = o.unverifiedTasks || 0;

    // 5. 当前活动任务状态
    renderActiveTask(snap);

    // 6. 课程列表渲染
    renderCoursesList(snap.courses || [], snap.selectedCourseKeys || [], snap.busy);

    // 7. 章节与任务树渲染
    renderTaskTree(snap.courses || [], snap.selectedCourseKeys || [], snap.active);
  }

  function renderActiveTask(snap) {
    if (!snap.active?.taskKey) {
      el.activeTaskTitle.textContent = snap.busy ? ((snap.phase === 'scanning'||snap.verification?.resumePhase==='scanning') ? `${snap.requiresVerification?'等待验证，扫描位置':'正在扫描'}：${snap.scan?.completedChapters || 0} / ${snap.scan?.totalChapters || 0} 节` : '队列准备中...') : '无活跃视频';
      el.activeTaskTime.textContent = '--:-- / --:--';
      document.getElementById('activeQuality').textContent = 'HTTP 协议运行 · 无浏览器 · 无视频解码';
      el.activeProgressBar.style.width = '0%';
      el.activeTaskChapter.textContent = snap.phase === 'idle' ? '等待用户操作' : (snap.phase === 'logging_in' ? '等待扫码中' : '等待开始');
      if(snap.phase==='scanning'||snap.verification?.resumePhase==='scanning')el.activeTaskChapter.textContent=[snap.discovery?.course,snap.discovery?.chapter||'读取目录'].filter(Boolean).join(' > ');
      return;
    }

    // 查找当前活动任务
    let activeTask = null, activeChapter = null, activeCourse = null;
    for (const course of snap.courses || []) {
      for (const ch of course.chapters || []) {
        for (const t of ch.tasks || []) {
          if (t.key === snap.active.taskKey) {
            activeTask = t;
            activeChapter = ch;
            activeCourse = course;
            break;
          }
        }
      }
    }

    if (activeTask) {
      el.activeTaskTitle.textContent = activeTask.title;
      el.activeTaskTitle.title = activeTask.title;
      const cur = activeTask.observedSeconds ?? activeTask.serverSeconds ?? 0;
      el.activeTaskTime.textContent = `${formatSeconds(cur)} / ${formatSeconds(activeTask.durationSeconds)}`;
      el.activeProgressBar.style.width = `${activeTask.progressPercent || 0}%`;
      el.activeRateBadge.textContent = activeTask.rate ? `${activeTask.rate}x` : '原生倍速';
      const q = activeTask.quality;
      const resolution = activeTask.videoWidth && activeTask.videoHeight ? `${activeTask.videoWidth}×${activeTask.videoHeight}` : '等待媒体信息';
      document.getElementById('activeQuality').textContent = `平台 ${formatSeconds(activeTask.serverSeconds)} · 已上报 ${formatSeconds(activeTask.reportedSeconds)} · 当前位置为本地估算`; 
      el.activeTaskChapter.textContent = [activeCourse?.title, ...(activeChapter?.path || []).map(p => p.title), activeChapter?.title].filter(Boolean).join(' > ');
    }
  }

  function renderCoursesList(courses, selectedKeys, isBusy) {
    const previousScrollTop = el.coursesList.scrollTop;
    el.courseCountBadge.textContent = `${courses.length} 门`;
    state.selectedKeys = new Set(selectedKeys);

    if (!courses.length) {
      el.coursesList.innerHTML = `<div class="empty-state">
        <p>尚未登录或未发现课程</p>
        <span class="empty-hint">点击右上角“登录 / 初始化”开始</span>
      </div>`;
      return;
    }

    el.coursesList.innerHTML = courses.map(course => {
      const isSelected = state.selectedKeys.has(course.key);
      const isEnded = course.ended;
      const pct = course.summary?.completionPercent;
      const pctText = course.empty ? '空课程 · 0 章节' : pct != null ? `${pct}%` : ({ready:'无任务',partial:'部分读取',failed:'读取失败',scanning:'扫描中',stale:'待复核'})[course.scanState] || '未扫描';

      return `<div class="course-card ${isSelected ? 'selected' : ''} ${isEnded ? 'ended' : ''}" data-key="${course.key}">
        <div class="course-header-row">
          <input type="checkbox" class="course-checkbox" data-key="${course.key}" 
            ${isSelected ? 'checked' : ''} ${isEnded || isBusy ? 'disabled' : ''}>
          <div class="course-title-col">
            <div class="course-title" title="${escapeHtml(course.title)}">${escapeHtml(course.title)}</div>
            <div class="course-sub-info">
              <span>${course.ended ? '<span class="badge" style="color:#ef4444">已结束</span>' : ''}</span>
              <span>ID: ${escapeHtml(course.courseId)}:${escapeHtml(course.clazzId)}</span>
              <span>· ${pctText}</span>
            </div>
          </div>
        </div>
        ${pct != null ? `<div class="progress-track course-progress-mini"><div class="progress-bar" style="width:${pct}%"></div></div>` : ''}
      </div>`;
    }).join('');

    // 绑定多选勾选事件
    el.coursesList.scrollTop = previousScrollTop;
    el.coursesList.querySelectorAll('.course-checkbox').forEach(box => {
      box.addEventListener('change', async e => {
        const key = e.target.getAttribute('data-key');
        if (e.target.checked) state.selectedKeys.add(key);
        else state.selectedKeys.delete(key);
        await saveCourseSelection();
      });
    });

    // 点击卡片也可触发勾选
    el.coursesList.querySelectorAll('.course-card').forEach(card => {
      card.addEventListener('click', async e => {
        if (e.target.tagName === 'INPUT') return;
        const box = card.querySelector('.course-checkbox');
        if (!box || box.disabled) return;
        box.checked = !box.checked;
        const key = card.getAttribute('data-key');
        if (box.checked) state.selectedKeys.add(key);
        else state.selectedKeys.delete(key);
        await saveCourseSelection();
      });
    });
  }

  async function saveCourseSelection() {
    try {
      await api('selectCourses', { courseKeys: [...state.selectedKeys] });
    } catch (_) {}
  }

  el.btnSelectAll.addEventListener('click', async () => {
    if (state.snapshot?.busy) return;
    const available = (state.snapshot?.courses || []).filter(c => !c.ended).map(c => c.key);
    state.selectedKeys = new Set(available);
    await saveCourseSelection();
  });

  el.btnDeselectAll.addEventListener('click', async () => {
    if (state.snapshot?.busy) return;
    state.selectedKeys.clear();
    await saveCourseSelection();
  });

  function renderTaskTree(courses, selectedKeys, activeInfo) {
    const previousScrollTop = el.treeContainer.scrollTop;
    const selectedSet = new Set(selectedKeys);
    const selectedCourses = courses.filter(c => selectedSet.has(c.key));

    if (!selectedCourses.length) {
      el.treeContainer.innerHTML = `<div class="empty-state">
        <p>请在左侧勾选课程并点击“开始学习”</p>
        <span class="empty-hint">支持多选，开始时自动扫描；也可单独扫描以查看目录和统计</span>
      </div>`;
      return;
    }

    const query = state.searchQuery.toLowerCase().trim();

    el.treeContainer.innerHTML = selectedCourses.map(course => {
      const cSum = course.summary || {};
      const cPct = cSum.completionPercent != null ? `${cSum.completionPercent}%` : '--%';
      
      function renderNode(node, ancestorMatch = false) {
        const nodeKey = node.key;
        const titleMatches = Boolean(query && `${node.number || ''} ${node.title}`.toLowerCase().includes(query));
        const inheritedMatch = ancestorMatch || titleMatches;
        const childrenHtml = (node.children || []).map(child => renderNode(child, inheritedMatch)).join('');
        if (!node.chapter) {
          if ((query && !inheritedMatch && !childrenHtml) || (state.filter !== 'all' && !childrenHtml)) return '';
          const sum = node.summary || {};
          const open = Boolean(query) || state.filter !== 'all' || !state.collapsedGroups.has(nodeKey);
          return `<section class="outline-group ${open ? 'open' : ''}">
            <div class="outline-group-header" data-outline-toggle="group" data-nodekey="${escapeHtml(nodeKey)}" role="button" tabindex="0" aria-expanded="${open}">
              <div class="chapter-title-wrap"><svg class="chevron-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg>
                ${node.number ? `<span class="outline-number">${escapeHtml(node.number)}</span>` : ''}<span class="outline-group-title">${escapeHtml(node.title)}</span></div>
              <span class="chapter-stats">任务 ${sum.taskPassed || 0}/${sum.taskTotal || 0}</span>
            </div>
            <div class="outline-children">${childrenHtml || '<div class="scan-empty-message">暂无已发布的小节</div>'}</div>
          </section>`;
        }
        const ch = node.chapter;
        const isOpen = Boolean(query) || state.filter !== 'all' || state.expandedChapters.has(nodeKey);
        const chSum = ch.summary || {};
        
        // 过滤任务
        const filteredTasks = (ch.tasks || []).filter(task => {
          if (query && !inheritedMatch && !task.title.toLowerCase().includes(query)) return false;
          if (state.filter === 'video' && task.type !== 'video') return false;
          if (state.filter === 'document' && task.type !== 'document') return false;
          if (state.filter === 'pending' && (!task.jobId || !task.verified || task.isPassed || !['video','document'].includes(task.type) || task.status === 'failed')) return false;
          if (state.filter === 'manual' && task.status !== 'manual') return false;
          if (state.filter === 'passed' && !task.isPassed) return false;
          return true;
        });

        if ((query && !filteredTasks.length && !inheritedMatch && !childrenHtml) || (state.filter !== 'all' && !filteredTasks.length && !childrenHtml)) {
          return ''; // 搜索时隐藏不匹配的章节
        }

        const tasksHtml = filteredTasks.map(task => {
          const isActive = activeInfo?.taskKey === task.key;
          const statusInfo = statusMap[task.status] || { label: task.status, cls: '' };
          const isVideo = task.type === 'video';
          const curTime = task.isPassed ? task.durationSeconds : task.observedSeconds ?? task.serverSeconds;
          const timeText = isVideo ? `${formatSeconds(curTime)} / ${formatSeconds(task.durationSeconds)}` : '非视频任务';
          const pct = task.progressPercent != null ? `${task.progressPercent}%` : (task.isPassed ? '100%' : '0%');

          return `<div class="task-row ${isActive ? 'task-active' : ''}">
            <div class="task-left">
              <span class="task-type-badge ${isVideo ? 'task-type-video' : 'task-type-doc'}">
                ${isVideo ? '视频' : task.type === 'document' ? (/\.pdf(?:$|\?)/i.test(task.title) ? 'PDF课件' : '课件') : ['workid','work','exam','quiz','homework'].includes(task.type) ? '测验/作业' : '未适配'}
              </span>
              <span class="task-title" title="${escapeHtml(task.title)} (${escapeHtml(task.key)})">
                ${escapeHtml(task.title)}
                ${isVideo ? `<small class="task-sync">平台 ${formatSeconds(task.serverSeconds)} · 上报 ${formatSeconds(task.reportedSeconds)} · 估算 ${formatSeconds(task.observedSeconds)}</small>` : ''}
              </span>
            </div>
            <div class="task-right">
              ${isVideo ? `
                <span class="task-time">${timeText}</span>
                <div class="progress-track task-progress-mini">
                  <div class="progress-bar" style="width: ${pct}"></div>
                </div>
                ${task.rate ? `<span class="badge" style="font-size:10px">${task.rate}x</span>` : ''}
              ` : ''}
              <button class="btn btn-sm btn-outline task-run" data-task="${escapeHtml(task.key)}" data-course="${escapeHtml(course.key)}" ${state.snapshot.busy||task.isPassed||!task.jobId||!['video','document'].includes(task.type)||(el.studyModeSelect.value!=='all'&&task.type!==el.studyModeSelect.value)?'disabled':''}>单节运行</button>
              <span class="status-badge ${statusInfo.cls}">
                ${statusInfo.label}
              </span>
            </div>
          </div>`;
        }).join('');

        return `<div class="chapter-accordion ${isOpen ? 'open' : ''}" data-chid="${escapeHtml(nodeKey)}">
          <div class="chapter-header" data-outline-toggle="chapter" data-nodekey="${escapeHtml(nodeKey)}" role="button" tabindex="0" aria-expanded="${isOpen}">
            <div class="chapter-title-wrap">
              <svg class="chevron-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg>
              ${ch.number ? `<span class="outline-number">${escapeHtml(ch.number)}</span>` : ''}<span class="chapter-title">${escapeHtml(ch.title)}</span>
              ${ch.fromCheckpoint ? `<span class="badge badge-subtle" title="复用章节位置，本次扫描仍重新读取任务状态">${ch.scanState === 'ready' ? '已复核' : '目录断点'}</span>` : ''}
              ${ch.empty ? '<span class="badge badge-subtle">空章节</span>' : ch.scanState === 'blocked' || ch.scanState === 'failed' ? `<span class="badge badge-subtle" title="${escapeHtml(ch.error?.message || '')}">${ch.scanState === 'blocked' ? '受限 / 需验证' : '读取失败'} · ${escapeHtml(ch.error?.code || '')}</span>` : ''}
            </div>
            <div class="chapter-stats">
              <span>任务 ${chSum.taskPassed || 0}/${chSum.taskTotal || 0}</span>
              ${chSum.manualTasks ? `<span style="color:#c084fc">需手动 ${chSum.manualTasks}</span>` : ''}
            </div>
          </div>
          <div class="tasks-container">
            ${tasksHtml || '<div style="color:var(--text-dim);font-size:11px;padding:4px 0">此章节下无符合过滤条件的任务</div>'}
          </div>
          ${childrenHtml ? `<div class="outline-children">${childrenHtml}</div>` : ''}
        </div>`;
      }
      const chaptersHtml = (course.outline || []).map(node => renderNode(node)).join('');

      return `<div class="course-block">
        <div class="course-banner">
          <div class="course-banner-title">
            <span>${escapeHtml(course.title)}</span>
            <span class="badge badge-subtle">${course.empty ? '空课程' : ({ready:'已扫描',partial:'部分读取',failed:'读取失败',scanning:'扫描中',stale:'待复核'})[course.scanState] || '未扫描'}</span>
          </div>
          <div class="course-banner-stats">
            <span>任务通过率: ${cPct}</span>
            <span>待学习: ${cSum.taskPending || 0}</span>
            <span>需手动: ${cSum.manualTasks || 0}</span>
            ${cSum.unverifiedTasks ? `<span>待核对: ${cSum.unverifiedTasks}</span>` : ''}
          </div>
        </div>
        <div class="chapters-list">
          ${chaptersHtml || `<div class="scan-empty-message">${course.empty ? '课程尚未发布章节（0 章节），已跳过。' : course.error ? escapeHtml(course.error.message) : '点击“开始学习”将自动扫描；也可先单独扫描查看目录。'}</div>`}
        </div>
      </div>`;
    }).join('');

    el.treeContainer.querySelectorAll('.task-run').forEach(button => button.addEventListener('click', async () => {
      try { await api('start', {courseKeys:[button.dataset.course], taskKeys:[button.dataset.task], rate:Number(el.rateSelect.value)||2,studyMode:el.studyModeSelect.value}); } catch (_) {}
    }));
    // 绑定章节折叠切换
    el.treeContainer.scrollTop = previousScrollTop;
    el.treeContainer.querySelectorAll('[data-outline-toggle]').forEach(header => {
      const toggle = () => {
        const key = header.dataset.nodekey, group = header.dataset.outlineToggle === 'group';
        const entries = group ? state.collapsedGroups : state.expandedChapters;
        const acc = header.parentElement, open = !acc.classList.contains('open');
        if (group ? !open : open) entries.add(key); else entries.delete(key);
        acc.classList.toggle('open', open);header.setAttribute('aria-expanded', String(open));
      };
      header.addEventListener('click', toggle);
      header.addEventListener('keydown', e => {if (e.key === 'Enter' || e.key === ' ') {e.preventDefault();toggle();}});
    });
  }

  // 过滤与搜索事件
  el.studyModeSelect.addEventListener('change',()=>{
    if(state.snapshot)renderTaskTree(state.snapshot.courses||[],state.snapshot.selectedCourseKeys||[],state.snapshot.active);
  });
  el.taskSearchInput.addEventListener('input', e => {
    state.searchQuery = e.target.value;
    if (state.snapshot) {
      renderTaskTree(state.snapshot.courses || [], state.snapshot.selectedCourseKeys || [], state.snapshot.active);
    }
  });

  el.filterTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      el.filterTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      state.filter = tab.getAttribute('data-filter');
      if (state.snapshot) {
        renderTaskTree(state.snapshot.courses || [], state.snapshot.selectedCourseKeys || [], state.snapshot.active);
      }
    });
  });

  el.btnExpandAll.addEventListener('click', () => {
    state.collapsedGroups.clear();
    for (const c of state.snapshot?.courses || []) {
      for (const ch of c.chapters || []) {
        state.expandedChapters.add(ch.key || `${c.key}:${ch.id}`);
      }
    }
    if (state.snapshot) renderTaskTree(state.snapshot.courses, state.snapshot.selectedCourseKeys, state.snapshot.active);
  });

  el.btnCollapseAll.addEventListener('click', () => {
    state.expandedChapters.clear();
    const closeGroups = nodes => {for (const n of nodes) {if (!n.chapter) state.collapsedGroups.add(n.key);closeGroups(n.children || []);}};
    for (const c of state.snapshot?.courses || []) closeGroups(c.outline || []);
    if (state.snapshot) renderTaskTree(state.snapshot.courses, state.snapshot.selectedCourseKeys, state.snapshot.active);
  });

  // 控制按钮操作绑定
  el.btnInit.addEventListener('click', async () => {
    try {
      el.btnInit.disabled = true;
      showAlert('正在检查本机登录会话...', false);
      window.cxLoginPanel?.open();
      await api('initialize');
    } catch (_) {}
  });

  el.btnScan.addEventListener('click', async () => {
    try {
      el.btnScan.disabled = true;
      showAlert('正在读取完整目录、核对各节任务状态并获取视频时长；无需开始学习即可查看统计。', false);
      await api('scan', { courseKeys: [...state.selectedKeys], resume: !document.getElementById('forceRescan').checked });
    } catch (_) { el.btnScan.disabled = !state.snapshot?.controls?.canScan; }
  });

  el.btnStart.addEventListener('click', async () => {
    try {
      const rate = Number(el.rateSelect.value) || 2;
      const maxTasksVal = el.maxTasksInput.value.trim();
      const maxTasks = maxTasksVal ? Number(maxTasksVal) : undefined;
      await api('start', { rate, maxTasks, courseKeys: [...state.selectedKeys], studyMode:el.studyModeSelect.value });
    } catch (_) {}
  });

  el.btnPause.addEventListener('click', async () => {
    try {
      await api('pause');
    } catch (_) {}
  });

  el.btnResume.addEventListener('click', async () => {
    try {
      await api('resume');
    } catch (_) {}
  });

  el.btnStop.addEventListener('click', async () => {
    try {
      await api('stop');
    } catch (_) {}
  });

  // 底部抽屉折叠
  el.btnCollapseDrawer.addEventListener('click', e => {
    e.stopPropagation();
    state.drawerOpen = !state.drawerOpen;
    el.bottomDrawer.classList.toggle('collapsed', !state.drawerOpen);
  });

  el.drawerToggle.addEventListener('click', e => {
    if (e.target.closest('.drawer-tabs')) return;
    state.drawerOpen = !state.drawerOpen;
    el.bottomDrawer.classList.toggle('collapsed', !state.drawerOpen);
  });

  // 抽屉选项卡切换
  el.drawerTabs.forEach(tab => {
    tab.addEventListener('click', e => {
      e.stopPropagation();
      const target = tab.getAttribute('data-tab');
      state.activeTab = target;
      el.drawerTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      el.tabPanes.forEach(p => p.classList.remove('active'));
      document.getElementById(target === 'logs' ? 'tabLogs' : 'tabVnc').classList.add('active');

      if (target === 'vnc') window.cxLoginPanel?.open();
    });
  });

  el.btnRefreshVnc.addEventListener('click', () => {
    window.cxLoginPanel?.open();
  });

  const btnToggleMode = document.getElementById('btnToggleMode');

  function updateModeBadge(mode) {
    state.mode = mode;
    if (mode === 'demo') {
      el.appModeBadge.textContent = '离线演示模式';
      el.appModeBadge.className = 'badge badge-accent';
    } else {
      el.appModeBadge.textContent = '真实超星模式';
      el.appModeBadge.className = 'badge badge-subtle';
    }
  }

  btnToggleMode.disabled = true; btnToggleMode.textContent = '无浏览器'; btnToggleMode.title = '当前使用 HTTP 协议运行';
  btnToggleMode?.addEventListener('click', async () => {
    const isDemo = state.mode === 'demo';
    const targetDemo = !isDemo;
    try {
      showAlert(`正在切换到【${targetDemo ? '离线模拟演示' : '真实超星'}】模式...`, false);
      const res = await api('mode', { demo: targetDemo });
      updateModeBadge(res.mode);
      showAlert(`已切换到【${targetDemo ? '离线模拟演示' : '真实超星'}】模式，可点击右上角“登录 / 初始化”开始`, false);
    } catch (err) {
      showAlert(`模式切换失败: ${err.message}`, true);
    }
  });

  // 页面加载启动
  async function init() {
    initSSE();
    try {
      const res = await api('status', null, 'GET');
      if (res?.snapshot) {
        renderSnapshot(res.snapshot);
      }
      if (res?.mode) {
        updateModeBadge(res.mode);
      }
    } catch (_) {}
  }

  init();
})();
