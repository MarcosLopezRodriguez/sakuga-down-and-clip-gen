let socket;
let currentDownloads = new Map();
let allDownloadedVideos = [];
let downloadsInProgress = false;

// Helper: stable key for tracking downloads (prefer tag over url)
function getDownloadKey(data) {
    if (data && typeof data.tag === 'string' && data.tag.length > 0) return `tag:${data.tag}`;
    if (data && typeof data.url === 'string' && data.url.length > 0) return `url:${data.url}`;
    return `misc:${Math.random().toString(36).slice(2)}`; // fallback, should rarely happen
}

// Track tags that already completed to avoid stale UI updates
let completedTags = new Set();
let activityHistory = JSON.parse(sessionStorage.getItem('activityHistory') || '[]');

// ----- Phase 4: History & Audio Helper Functions -----
function addToHistory(message, type = 'info') {
    const event = {
        id: Date.now(),
        time: new Date().toLocaleTimeString(),
        message,
        type // 'success', 'error', 'info'
    };
    activityHistory.unshift(event);
    if (activityHistory.length > 50) activityHistory.pop();
    sessionStorage.setItem('activityHistory', JSON.stringify(activityHistory));
    renderHistory();
}

function renderHistory() {
    const list = document.getElementById('historyList');
    if (!list) return;

    if (activityHistory.length === 0) {
        list.innerHTML = '<div class="text-muted text-center py-4"><i class="bi bi-info-circle fs-2 d-block mb-2"></i>Sin actividad reciente</div>';
        return;
    }

    list.innerHTML = activityHistory.map(item => `
        <div class="history-item ${item.type}">
            <div class="d-flex justify-content-between small opacity-75">
                <span>${item.time}</span>
            </div>
            <div class="mt-1">${item.message}</div>
        </div>
    `).join('');
}


// Global selection tracking
function updateGlobalBatchBar() {
    const bar = document.getElementById('batchActionBar');
    const countEl = document.getElementById('globalSelectedCount');
    let total = 0;
    selectedClipsMap.forEach(set => total += set.size);

    if (total > 0) {
        bar.style.display = 'block';
        countEl.textContent = total;
        document.body.classList.add('batch-active');
    } else {
        bar.style.display = 'none';
        document.body.classList.remove('batch-active');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // Utilidad: debounce para reducir repintados en inputs de filtro
    function debounce(fn, wait = 250) {
        let t;
        return (...args) => {
            clearTimeout(t);
            t = setTimeout(() => fn.apply(null, args), wait);
        };
    }

    // Conexión de Socket.IO
    socket = io();

    // Tab navigation
    const navLinks = document.querySelectorAll('.navbar-nav .nav-link');
    const sections = document.querySelectorAll('.section-content');
    const DEFAULT_SECTION = 'download';

    function activateSection(sectionId, { persist = true, focusLink = true } = {}) {
        if (!sectionId) return;

        sections.forEach(section => section.classList.remove('active'));
        navLinks.forEach(navLink => {
            navLink.classList.remove('active');
            navLink.removeAttribute('aria-current');
        });

        const targetSectionElement = document.getElementById(sectionId);
        if (targetSectionElement) {
            targetSectionElement.classList.add('active');
        }

        const targetLink = document.querySelector(`.navbar-nav .nav-link[data-section="${sectionId}"]`);
        if (targetLink) {
            targetLink.classList.add('active');
            targetLink.setAttribute('aria-current', 'page');
            if (focusLink) {
                try {
                    targetLink.focus({ preventScroll: true });
                } catch (_) {
                    targetLink.focus();
                }
            }
        }

        if (sectionId === 'rename-clips') {
            fetchAndDisplayClipFolders();
        } else if (sectionId === 'beat-sync') {
            fetchAndDisplayBeatSyncClipFolders(); // Function to be added later
        }

        if (persist) {
            localStorage.setItem('activeSection', sectionId);
        }
    }

    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const targetSectionId = link.dataset.section;
            activateSection(targetSectionId);
        });
    });

    const hashSection = window.location.hash ? window.location.hash.replace('#', '') : '';
    const initialSectionId = hashSection && document.getElementById(hashSection)
        ? hashSection
        : DEFAULT_SECTION;
    activateSection(initialSectionId, { persist: true, focusLink: false });

    // Specific elements for the "Rename Clips" tab
    const folderLoadingIndicator = document.getElementById('folder-loading-indicator');
    const folderListContainer = document.getElementById('folder-list-container');
    const renameButton = document.getElementById('rename-button');
    const renameFeedback = document.getElementById('rename-feedback');
    let allClipFolders = []; // Variable to store all clip folders for rename tab

    // Specific elements for "Beat Sync" tab
    const beatSyncFolderListContainer = document.getElementById('beatSyncFolderListContainer');
    const beatSyncFolderFilterInput = document.getElementById('beatSyncFolderFilterInput');
    const beatSyncSelectAllFoldersBtn = document.getElementById('beatSyncSelectAllFoldersBtn');
    const beatSyncDeselectAllFoldersBtn = document.getElementById('beatSyncDeselectAllFoldersBtn');
    const audioFileUploadInput = document.getElementById('audioFileUpload');
    const audioInfoDiv = document.getElementById('audioInfo');
    const audioStartTimeInput = document.getElementById('audioStartTime');
    const audioEndTimeInput = document.getElementById('audioEndTime');
    const audioRangeSlider = document.getElementById('audioRangeSlider');
    const audioPreview = document.getElementById('audioPreview');
    let audioDuration = 0;
    // Note: beatSyncForm and generateBeatSyncVideoBtn will be handled for form submission later.
    let allBeatSyncClipFolders = []; // Variable to store all clip folders for beat-sync tab
    let analyzedAudioFileName = '';

    const downloadUrlInput = document.getElementById('downloadUrl');
    if (downloadUrlInput) {
        downloadUrlInput.addEventListener('dragover', (e) => e.preventDefault());
        downloadUrlInput.addEventListener('drop', (e) => {
            e.preventDefault();
            const text = e.dataTransfer.getData('text');
            if (text) {
                downloadUrlInput.value = text.trim();
            }
        });
    }

    if (audioFileUploadInput) {
        ['dragover', 'dragenter'].forEach(evt => {
            audioFileUploadInput.addEventListener(evt, (e) => e.preventDefault());
        });
        audioFileUploadInput.addEventListener('drop', (e) => {
            e.preventDefault();
            const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('audio/'));
            if (files.length > 0) {
                const dt = new DataTransfer();
                files.forEach(file => dt.items.add(file));
                audioFileUploadInput.files = dt.files;
                audioFileUploadInput.dispatchEvent(new Event('change'));
            }
        });
    }

    // Initialize video lists
    loadVideoLists();
    loadFoldersList();

    // Folder selection change event
    const folderSelectEl = document.getElementById('folderSelect');
    folderSelectEl.addEventListener('change', (e) => {
        localStorage.setItem('selectedFolder', e.target.value);
    });
    const savedFolder = localStorage.getItem('selectedFolder');
    if (savedFolder) {
        folderSelectEl.value = savedFolder;
    }

    // Download URL form submission
    document.getElementById('downloadUrlForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const urlRaw = document.getElementById('downloadUrl').value.trim();
        if (!urlRaw) return;
        // Basic URL validation and length limits
        const MAX_URL_LEN = 2000;
        if (urlRaw.length > MAX_URL_LEN) {
            showDownloadError('La URL es demasiado larga.');
            return;
        }
        const urlPattern = /^(https?:\/\/)[^\s]+$/i;
        if (!urlPattern.test(urlRaw)) {
            showDownloadError('La URL no es válida. Debe empezar por http(s)://');
            return;
        }
        // Disable submit button during process
        const submitBtn = e.submitter || document.querySelector('#downloadUrlForm button[type="submit"]');
        if (submitBtn) submitBtn.setAttribute('disabled', 'true');
        try {
            await startDownload({ url: urlRaw });
        } finally {
            if (submitBtn) submitBtn.removeAttribute('disabled');
        }
    });

    // Download tags form submission
    const downloadTagsInput = document.getElementById('downloadTags');
    const savedTags = localStorage.getItem('lastTags');
    if (savedTags) downloadTagsInput.value = savedTags;
    document.getElementById('downloadTagsForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const tagsText = downloadTagsInput.value.trim();
        if (!tagsText) return;

        const MAX_TAGS = 50;
        const MAX_TAG_LEN = 64;
        const TAG_RE = /^[A-Za-z0-9_.:\-]+$/;
        const tags = tagsText.split(';')
            .map(tag => tag.trim())
            .filter(tag => tag.length > 0)
            .slice(0, MAX_TAGS)
            .filter(tag => tag.length <= MAX_TAG_LEN && TAG_RE.test(tag));
        if (tags.length === 0) {
            showDownloadError('No hay etiquetas válidas. Usa letras, números, _ - . : separadas por ;');
            return;
        }
        localStorage.setItem('lastTags', tags.join(';'));
        // Disable submit button during process
        const submitBtn = e.submitter || document.querySelector('#downloadTagsForm button[type="submit"]');
        if (submitBtn) submitBtn.setAttribute('disabled', 'true');
        try {
            await startDownload({ tags });
        } finally {
            if (submitBtn) submitBtn.removeAttribute('disabled');
        }
    });

    // Generate clips form submission
    function readSceneOptionsFromForm() {
        const parseFloatSafe = (value) => {
            const n = parseFloat(value);
            return Number.isFinite(n) ? n : undefined;
        };
        const parseIntSafe = (value) => {
            const n = parseInt(value, 10);
            return Number.isFinite(n) ? n : undefined;
        };

        const minDuration = parseFloatSafe(document.getElementById('minDuration').value);
        const maxDuration = parseFloatSafe(document.getElementById('maxDuration').value);
        const threshold = parseFloatSafe(document.getElementById('threshold').value);
        const maxClipsPerVideo = parseIntSafe(document.getElementById('maxClipsPerVideo')?.value);
        const scenePadding = parseFloatSafe(document.getElementById('scenePadding')?.value);
        const minGapBetweenClips = parseFloatSafe(document.getElementById('minGapBetweenClips')?.value);
        const detectionSelect = document.getElementById('detectionMethod');
        const detectionMethod = detectionSelect ? detectionSelect.value : undefined;

        const options = {};
        if (minDuration && minDuration > 0) options.minDuration = minDuration;
        if (maxDuration && maxDuration > 0) options.maxDuration = maxDuration;
        if (threshold && threshold > 0) options.threshold = threshold;
        if (maxClipsPerVideo && maxClipsPerVideo > 0) options.maxClipsPerVideo = maxClipsPerVideo;
        if (typeof scenePadding === 'number' && scenePadding >= 0) options.scenePadding = scenePadding;
        if (typeof minGapBetweenClips === 'number' && minGapBetweenClips >= 0) options.minGapBetweenClips = minGapBetweenClips;
        if (detectionMethod) options.detectionMethod = detectionMethod;
        return options;
    }

    document.getElementById('generateClipsForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const folderPath = document.getElementById('folderSelect').value;
        const sceneOptions = readSceneOptionsFromForm();

        await generateClipsFromFolder(folderPath, sceneOptions);
    });

    // Generate clips for all folders
    const generateAllBtn = document.getElementById('generateAllClipsBtn');
    if (generateAllBtn) {
        generateAllBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            const sceneOptions = readSceneOptionsFromForm();

            await generateClipsFromFolder('', sceneOptions);
        });
    }

    // Handle browser tab switching to refresh content
    document.querySelectorAll('#browserTabs .nav-link').forEach(tab => {
        tab.addEventListener('shown.bs.tab', () => {
            loadVideoLists();
        });
    });

    // Clips per page selector
    const clipsPerPageSelect = document.getElementById('clipsPerPageSelect');
    clipsPerPageSelect.value = CLIPS_PER_PAGE;
    clipsPerPageSelect.addEventListener('change', (e) => {
        CLIPS_PER_PAGE = parseInt(e.target.value);
        localStorage.setItem('clipsPerPage', CLIPS_PER_PAGE);

        // Reset all pagination states when changing clips per page
        videoPaginationState.clear();

        // Refresh clips display
        loadVideoLists();
    });

    // Refresh clips button
    document.getElementById('refreshClipsBtn').addEventListener('click', () => {
        loadVideoLists();
    });

    // Keyboard shortcuts for pagination
    document.addEventListener('keydown', (e) => {
        // Only handle shortcuts when clips tab is active
        const clipsTab = document.getElementById('clipsTab');
        if (!clipsTab.classList.contains('active')) return;

        // Get the first video section for keyboard navigation
        const firstVideoSection = document.querySelector('.video-section');
        if (!firstVideoSection) return;

        const videoName = firstVideoSection.id.replace('video-section-', '').replace(/-/g, ' ');
        const currentState = videoPaginationState.get(videoName);
        if (!currentState) return;

        const currentPage = currentState.currentPage;

        // Handle arrow keys for pagination
        if (e.ctrlKey) {
            if (e.key === 'ArrowLeft' && currentPage > 1) {
                e.preventDefault();
                changeVideoPage(videoName, currentPage - 1);
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                changeVideoPage(videoName, currentPage + 1);
            }
        }
    });

    // Setup video modal
    setupVideoPlayer();

    const shortcutTooltipEl = document.getElementById('paginationShortcuts');
    if (shortcutTooltipEl) {
        new bootstrap.Tooltip(shortcutTooltipEl);
    }

    // Initialize all tooltips
    const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
    tooltipTriggerList.map(function (tooltipTriggerEl) {
        return new bootstrap.Tooltip(tooltipTriggerEl);
    });

    // ----- Configuration Presets -----
    const presets = {
        fast: { minDuration: 0.5, maxDuration: 2.5, threshold: 22, maxClips: 50, padding: 0.05 },
        balanced: { minDuration: 1.2, maxDuration: 6, threshold: 28, maxClips: 30, padding: 0.1 },
        precise: { minDuration: 2, maxDuration: 12, threshold: 42, maxClips: 20, padding: 0.2 },
        long: { minDuration: 5, maxDuration: 60, threshold: 35, maxClips: 10, padding: 0.25 }
    };

    document.querySelectorAll('.preset-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const presetKey = btn.dataset.preset;
            const config = presets[presetKey];
            if (!config) return;

            // Update inputs
            document.getElementById('minDuration').value = config.minDuration;
            document.getElementById('maxDuration').value = config.maxDuration;
            document.getElementById('threshold').value = config.threshold;
            if (document.getElementById('maxClipsPerVideo')) document.getElementById('maxClipsPerVideo').value = config.maxClips;
            if (document.getElementById('scenePadding')) document.getElementById('scenePadding').value = config.padding;

            // Visual update
            document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            showToast(`Preset "${btn.textContent.trim()}" aplicado`, 'info');
        });
    });

    // ----- Onboarding Tour -----
    function initOnboardingTour() {
        if (localStorage.getItem('onboardingCompleted')) return;

        const tour = new Shepherd.Tour({
            useModalOverlay: true,
            defaultStepOptions: {
                classes: 'shadow-md bg-purple-dark',
                scrollTo: { behavior: 'smooth', block: 'center' }
            }
        });

        tour.addStep({
            id: 'welcome',
            title: '¡Bienvenido a SakugaDown!',
            text: 'Esta herramienta te permite descargar videos de Sakugabooru y generar clips automáticamente usando IA y detección de escenas.',
            buttons: [
                { text: 'Omitir', action: () => { localStorage.setItem('onboardingCompleted', 'true'); tour.complete(); }, classes: 'shepherd-button-secondary' },
                { text: 'Siguiente', action: tour.next }
            ]
        });

        tour.addStep({
            id: 'download',
            element: '#download',
            title: 'Descarga de Videos',
            text: 'Pega una URL de Sakugabooru o una lista de etiquetas para descargar videos masivamente.',
            attachTo: { element: '#download', on: 'bottom' },
            buttons: [
                { text: 'Atrás', action: tour.back, classes: 'shepherd-button-secondary' },
                { text: 'Siguiente', action: tour.next }
            ]
        });

        tour.addStep({
            id: 'generate',
            element: '#generate',
            title: 'Generación de Clips',
            text: 'Configura los parámetros para detectar escenas. ¡Usa los <b>Presets</b> para ir más rápido!',
            attachTo: { element: '#presetsSection', on: 'top' },
            buttons: [
                { text: 'Atrás', action: tour.back, classes: 'shepherd-button-secondary' },
                { text: 'Siguiente', action: tour.next }
            ]
        });

        tour.addStep({
            id: 'browser',
            element: '#browserTab',
            title: 'Explorador de Videos',
            text: 'Aquí aparecerán tus videos descargados y clips generados listos para previsualizar.',
            attachTo: { element: '#browserTab', on: 'bottom' },
            buttons: [
                { text: 'Entendido', action: () => { localStorage.setItem('onboardingCompleted', 'true'); tour.complete(); } }
            ]
        });

        setTimeout(() => tour.start(), 1000);
    }

    initOnboardingTour();

    // ----- Real-time Validation -----
    const booruUrlInput = document.getElementById('downloadUrl');
    if (booruUrlInput) {
        booruUrlInput.addEventListener('input', debounce(() => {
            const val = booruUrlInput.value.trim();
            if (!val) {
                booruUrlInput.classList.remove('is-valid', 'is-invalid');
                return;
            }
            const isSakuga = /sakugabooru\.com\/post\/show\/\d+/.test(val) || /sakugabooru\.com\/.*tags=/.test(val);
            booruUrlInput.classList.toggle('is-valid', isSakuga);
            booruUrlInput.classList.toggle('is-invalid', !isSakuga);
        }, 500));
    }

    const booruTagsInput = document.getElementById('downloadTags');
    if (booruTagsInput) {
        booruTagsInput.addEventListener('input', debounce(() => {
            const val = booruTagsInput.value.trim();
            if (!val) {
                booruTagsInput.classList.remove('is-valid', 'is-invalid');
                return;
            }
            const isValid = val.split(';').some(t => t.trim().length > 1);
            booruTagsInput.classList.toggle('is-valid', isValid);
            booruTagsInput.classList.toggle('is-invalid', !isValid);
        }, 500));
    }

    // ----- Socket.IO Event Handlers -----
    socket.on('connect', () => {
        console.log('Conectado al servidor WebSocket');
        showToast('Conectado al servidor', 'success');
    });
    socket.on('disconnect', (reason) => {
        console.warn('Desconectado del servidor WebSocket:', reason);
        showToast('Conexión perdida. Reintentando...', 'warning');
    });
    socket.on('reconnect_attempt', (attempt) => {
        console.log('Intentando reconectar...', attempt);
    });
    socket.on('reconnect', (attempt) => {
        console.log('Reconectado tras intentos:', attempt);
        showToast('Reconectado al servidor', 'success');
    });
    socket.on('connect_error', (err) => {
        console.error('Error de conexión WebSocket:', err);
        showToast('Error de conexión con el servidor', 'danger');
    });

    // Eventos de descarga
    socket.on('downloadStarted', (data) => {
        console.log('Descarga iniciada:', data);
        showDownloadStatus(`${data.message}`);
        showToast(data.message, 'info');

        downloadsInProgress = true;

        // If restarting a tag, ensure it's not marked as completed
        if (data && typeof data.tag === 'string') {
            completedTags.delete(data.tag);
        }

        // Almacenar información de la descarga
        const key = getDownloadKey(data);
        if (!currentDownloads.has(key)) {
            currentDownloads.set(key, {
                url: data.url,
                tag: data.tag,
                status: data.status,
                message: data.message,
                progress: data.progress,
                startTime: Date.now(),
                lastUpdate: Date.now()
            });
        }

        updateDownloadList();
    });

    socket.on('downloadProgress', (data) => {
        console.log('Progreso de descarga:', data);

        // Ignore stale progress for completed tags
        if (data && typeof data.tag === 'string' && completedTags.has(data.tag)) {
            return;
        }
        // If there are no active downloads tracked anymore, ignore stray progress
        if (currentDownloads.size === 0) {
            return;
        }

        // Actualizar información de la descarga
        const key = getDownloadKey(data);
        const download = currentDownloads.get(key);
        if (download) {
            download.status = data.status;
            download.message = data.message;
            if (data.progress) {
                download.progress = data.progress;
                download.lastUpdate = Date.now();
            }
        } else {
            currentDownloads.set(key, {
                url: data.url,
                tag: data.tag,
                status: data.status,
                message: data.message,
                progress: data.progress,
                startTime: Date.now(),
                lastUpdate: Date.now()
            });
        }

        showDownloadStatus(`${data.message}`);
        if (data && data.progress !== undefined) {
            updateDownloadProgress(data.progress, key);
        }

        updateDownloadList();
    });

    socket.on('downloadComplete', (data) => {
        console.log('Descarga completada:', data);
        showToast(`Descarga completada: ${data.fileName || data.url}`, 'success');
        addToHistory(`Descargado: ${data.fileName || data.url}`, 'success');

        // Remover de las descargas activas
        const key = getDownloadKey(data);
        if (currentDownloads.has(key)) currentDownloads.delete(key);
        // Also try by raw url key if tracking differed earlier
        if (currentDownloads.has(`url:${data.url}`)) currentDownloads.delete(`url:${data.url}`);

        // Añadir a la lista de resultados de descarga
        addDownloadResult(data);

        updateDownloadList();

        if (currentDownloads.size === 0) {
            showDownloadStatus('Descargas finalizadas');
            downloadsInProgress = false;
        }

        // Recargar listas de videos
        loadVideoLists();
    });

    socket.on('downloadError', (data) => {
        console.error('Error de descarga:', data);
        showDownloadError(data.message);
        showToast(`Error: ${data.message}`, 'danger');
        addToHistory(`Error: ${data.message}`, 'error');

        // Actualizar estado de la descarga
        const key = getDownloadKey(data);
        if (currentDownloads.has(key)) {
            const download = currentDownloads.get(key);
            download.status = 'error';
            download.message = data.message;
            currentDownloads.set(key, download);
        }

        updateDownloadList();

        if (currentDownloads.size === 0) {
            showDownloadStatus('Descargas finalizadas');
            downloadsInProgress = false;
        }
    });

    socket.on('directoriesUpdated', (data) => {
        console.log('Directorios actualizados:', data);
        if (data.type === 'downloads') {
            displayDownloadedVideos(data.contents);
            updateAllVideosCache(data.contents);
            loadFoldersList();
        } else if (data.type === 'clips') {
            displayGeneratedClips(data.contents);
        }
    });

    socket.on('postsFound', (data) => {
        console.log('Posts encontrados:', data);
        if (data && typeof data.tag === 'string' && completedTags.has(data.tag)) {
            return;
        }
        // If there are no active downloads, ignore stale status updates
        if (currentDownloads.size === 0) {
            return;
        }
        showDownloadStatus(`${data.message}`);
    });

    socket.on('tagProcessingStarted', (data) => {
        console.log('Procesamiento de etiqueta iniciado:', data);
        showDownloadStatus(`${data.message}`);
        showToast(data.message, 'info');
    });

    socket.on('tagProcessingComplete', (data) => {
        console.log('Procesamiento de etiqueta completado:', data);
        // Update status and toast
        showDownloadStatus(`${data.message}`);
        showToast(data.message, 'success');

        // Mark tag as completed to suppress further progress events
        if (data && typeof data.tag === 'string') {
            completedTags.add(data.tag);
        }

        // Remove any active download entries matching this tag
        try {
            if (data && typeof data.tag === 'string') {
                for (const [key, dl] of currentDownloads.entries()) {
                    const url = dl && typeof dl.url === 'string' ? dl.url : '';
                    const matchesTag = dl && dl.tag === data.tag;
                    const urlContainsTag = url && (url.includes(data.tag) || url.includes(encodeURIComponent(data.tag)));
                    const isSearching = dl && dl.status === 'searching';
                    if (matchesTag || (isSearching && urlContainsTag)) {
                        currentDownloads.delete(key);
                    }
                }
            }
            // Aggressively remove any generic 'Procesando página ...' leftovers
            for (const [key, dl] of currentDownloads.entries()) {
                const msg = dl && typeof dl.message === 'string' ? dl.message : '';
                const isSearching = dl && dl.status === 'searching';
                if (isSearching || /^Procesando página\s+\d+\.\.\./.test(msg)) {
                    currentDownloads.delete(key);
                }
            }
        } catch (_) { /* noop */ }

        // Hide progress bar and update list
        const progress = document.querySelector('#download .progress');
        if (progress) progress.style.display = 'none';

        // Reset flag if no more active downloads
        if (currentDownloads.size === 0) {
            downloadsInProgress = false;
            const statusEl = document.getElementById('downloadStatus');
            if (statusEl) statusEl.textContent = 'Descargas finalizadas';
        }
        updateDownloadList();
    });

    // --- Rename Clips Tab Functionality ---

    function renderClipFolderList(foldersToShow) {
        if (!folderListContainer) return;
        folderListContainer.innerHTML = '';

        if (!Array.isArray(foldersToShow) || foldersToShow.length === 0) {
            folderListContainer.innerHTML = `
                <div class="col-12 text-center py-5">
                    <i class="bi bi-folder2-open display-1 text-muted opacity-25"></i>
                    <p class="text-muted mt-3">No se encontraron carpetas de clips.</p>
                </div>`;
            return;
        }

        foldersToShow.forEach((folder, index) => {
            const col = document.createElement('div');
            col.className = 'col-md-4 col-lg-3 animate-fade-in';
            col.style.animationDelay = `${index * 0.05}s`;

            const card = document.createElement('div');
            card.className = 'card folder-card-advanced shadow-sm';

            const checkboxId = `folderCheckbox-${folder.replace(/[^a-zA-Z0-9]/g, '-')}`;

            card.innerHTML = `
                <div class="card-body position-relative">
                    <input class="form-check-input folder-checkbox" type="checkbox" value="${folder}" id="${checkboxId}">
                    <div class="folder-icon-box">
                        <i class="bi bi-folder-fill"></i>
                    </div>
                    <div class="folder-info">
                        <h6 class="card-title mb-1 text-truncate" title="${folder}">${folder}</h6>
                        <span class="badge bg-light text-dark border fw-normal">Clips MP4</span>
                    </div>
                </div>
            `;

            // Hacer que toda la tarjeta sea clickable (toggle del checkbox)
            card.addEventListener('click', (e) => {
                if (e.target.type === 'checkbox') return;
                const cb = card.querySelector('input[type="checkbox"]');
                cb.checked = !cb.checked;
                card.classList.toggle('selected', cb.checked);
            });

            const cb = card.querySelector('input[type="checkbox"]');
            cb.addEventListener('change', () => {
                card.classList.toggle('selected', cb.checked);
            });

            col.appendChild(card);
            folderListContainer.appendChild(col);
        });
    }

    async function fetchAndDisplayClipFolders() {
        if (!folderLoadingIndicator || !folderListContainer || !renameFeedback) {
            console.error('Required elements for rename clips tab are missing.');
            return;
        }

        folderLoadingIndicator.style.display = 'block';
        // folderListContainer.innerHTML = ''; // Clear previous list - Handled by renderClipFolderList
        renameFeedback.innerHTML = '';    // Clear previous feedback
        renameFeedback.className = 'mt-3'; // Reset class

        try {
            const response = await fetch('/api/clips/list-folders');
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ message: 'Failed to fetch folders. Server returned an error.' }));
                throw new Error(errorData.message || `HTTP error ${response.status}`);
            }
            const folders = await response.json();
            allClipFolders = folders; // Store fetched folders
            renderClipFolderList(allClipFolders); // Display all folders initially

            // Setup event listeners for filter and select/deselect buttons
            // Ensure this is done only once or remove previous listeners if called multiple times
            const folderFilterInput = document.getElementById('folderFilterInput');
            const selectAllFoldersBtn = document.getElementById('selectAllFoldersBtn');
            const deselectAllFoldersBtn = document.getElementById('deselectAllFoldersBtn');

            if (folderFilterInput) {
                const debouncedFilter = debounce((e) => {
                    const filterText = e.target.value.toLowerCase();
                    const filteredFolders = allClipFolders.filter(folder => folder.toLowerCase().includes(filterText));
                    renderClipFolderList(filteredFolders);
                }, 250);
                folderFilterInput.addEventListener('input', debouncedFilter);
            }

            if (selectAllFoldersBtn) {
                selectAllFoldersBtn.addEventListener('click', () => {
                    folderListContainer.querySelectorAll('.folder-card-advanced').forEach(card => {
                        const cb = card.querySelector('input[type="checkbox"]');
                        cb.checked = true;
                        card.classList.add('selected');
                    });
                });
            }

            if (deselectAllFoldersBtn) {
                deselectAllFoldersBtn.addEventListener('click', () => {
                    folderListContainer.querySelectorAll('.folder-card-advanced').forEach(card => {
                        const cb = card.querySelector('input[type="checkbox"]');
                        cb.checked = false;
                        card.classList.remove('selected');
                    });
                });
            }

        } catch (error) {
            console.error('Error fetching clip folders:', error);
            allClipFolders = []; // Ensure it's an empty array on error
            renderClipFolderList(allClipFolders); // Display error/empty message
            // folderListContainer.innerHTML = `<p class="text-danger">Error loading folders: ${error.message}</p>`;
        } finally {
            folderLoadingIndicator.style.display = 'none';
        }
    }

    async function handleRenameButtonClick() {
        if (!folderListContainer || !renameFeedback || !renameButton) {
            console.error('Required elements for rename clips tab are missing.');
            return;
        }

        const selectedCheckboxes = folderListContainer.querySelectorAll('input[type="checkbox"]:checked');
        const selectedFolders = Array.from(selectedCheckboxes).map(cb => cb.value);
        let outputSubfolderName = document.getElementById('outputSubfolderName').value.trim();
        if (!outputSubfolderName.endsWith('_random')) {
            outputSubfolderName += '_random';
        }

        renameFeedback.innerHTML = '';
        renameFeedback.className = 'mt-3'; // Reset class

        if (selectedFolders.length === 0) {
            renameFeedback.textContent = 'Please select at least one folder.';
            renameFeedback.classList.add('alert', 'alert-warning');
            return;
        }
        if (!outputSubfolderName) {
            renameFeedback.textContent = 'Please enter a name for the output subfolder.';
            renameFeedback.classList.add('alert', 'alert-warning');
            return;
        }

        renameFeedback.textContent = 'Processing...';
        renameFeedback.classList.add('alert', 'alert-info');
        renameButton.disabled = true;

        try {
            const response = await fetch('/api/clips/rename-videos', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ selectedFolders, outputSubfolder: outputSubfolderName }),
            });

            const result = await response.json();

            if (response.ok) {
                renameFeedback.textContent = `${result.message} Details: ${result.details || 'N/A'}`;
                renameFeedback.classList.remove('alert-info', 'alert-danger');
                renameFeedback.classList.add('alert', 'alert-success');
                addToHistory(`Renombrados clips de ${selectedFolders.length} carpetas`, 'success');
                selectedCheckboxes.forEach(cb => {
                    cb.checked = false;
                    cb.closest('.folder-card-advanced').classList.remove('selected');
                });
            } else {
                renameFeedback.textContent = `Error: ${result.message || 'Unknown error'} Details: ${result.details || 'N/A'}`;
                renameFeedback.classList.remove('alert-info', 'alert-success');
                renameFeedback.classList.add('alert', 'alert-danger');
                addToHistory(`Error al renombrar: ${result.message}`, 'error');
            }
        } catch (error) {
            console.error('Error renaming clips:', error);
            renameFeedback.textContent = `Network error or failed to parse response: ${error.message}`;
            renameFeedback.classList.remove('alert-info', 'alert-success');
            renameFeedback.classList.add('alert', 'alert-danger');
        } finally {
            renameButton.disabled = false;
        }
    }

    if (renameButton) {
        renameButton.addEventListener('click', handleRenameButtonClick);
    }
    // Initial call if rename-clips is the active tab by default (e.g. after page refresh on that tab)
    // This depends on how active tab state is persisted or set on load.
    // For now, relying on tab click. If direct load to tab is possible, add:
    // if (document.querySelector('.navbar-nav .nav-link[data-section="rename-clips"].active')) {
    //    fetchAndDisplayClipFolders();
    // }
    // Similarly for beat-sync, if it can be default active
    if (document.querySelector('.navbar-nav .nav-link[data-section="beat-sync"].active')) {
        fetchAndDisplayBeatSyncClipFolders();
    }

    // --- Beat Sync Tab Functionality ---

    function renderBeatSyncClipFolderList(foldersToShow) {
        if (!beatSyncFolderListContainer) return;
        beatSyncFolderListContainer.innerHTML = '';

        if (!Array.isArray(foldersToShow) || foldersToShow.length === 0) {
            beatSyncFolderListContainer.innerHTML = `
                <div class="col-12 text-center py-4">
                    <p class="text-muted small">No se encontraron carpetas.</p>
                </div>`;
            return;
        }

        foldersToShow.forEach((folder, index) => {
            const col = document.createElement('div');
            col.className = 'col-md-6 animate-fade-in';
            col.style.animationDelay = `${index * 0.03}s`;

            const card = document.createElement('div');
            card.className = 'card folder-card-advanced shadow-sm py-2 px-3 h-100';

            const checkboxId = `beatSyncFolderCheckbox-${folder.replace(/[^a-zA-Z0-9]/g, '-')}`;

            card.innerHTML = `
                <div class="d-flex align-items-center gap-3">
                    <input class="form-check-input m-0" type="checkbox" value="${folder}" id="${checkboxId}">
                    <div class="folder-icon-box mb-0" style="width: 32px; height: 32px; font-size: 1rem; border-radius: 8px;">
                        <i class="bi bi-folder-fill"></i>
                    </div>
                    <div class="text-truncate flex-grow-1">
                        <small class="fw-bold d-block text-truncate" title="${folder}">${folder}</small>
                    </div>
                </div>
            `;

            card.addEventListener('click', (e) => {
                if (e.target.type === 'checkbox') return;
                const cb = card.querySelector('input[type="checkbox"]');
                cb.checked = !cb.checked;
                card.classList.toggle('selected', cb.checked);
            });

            const cb = card.querySelector('input[type="checkbox"]');
            cb.addEventListener('change', () => {
                card.classList.toggle('selected', cb.checked);
            });

            col.appendChild(card);
            beatSyncFolderListContainer.appendChild(col);
        });
    }

    async function fetchAndDisplayBeatSyncClipFolders() {
        if (!beatSyncFolderListContainer) {
            console.error('Beat sync folder list container not found.');
            return;
        }
        // Display a loading message
        beatSyncFolderListContainer.innerHTML = '<p class="text-muted">Loading clip folders...</p>';

        try {
            const response = await fetch('/api/random-names/list-folders');
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ message: 'Failed to fetch clip folders for beat sync. Server returned an error.' }));
                throw new Error(errorData.message || `HTTP error ${response.status}`);
            }
            const folders = await response.json();
            allBeatSyncClipFolders = folders;
            renderBeatSyncClipFolderList(allBeatSyncClipFolders);

        } catch (error) {
            console.error('Error fetching clip folders for beat sync:', error);
            allBeatSyncClipFolders = [];
            beatSyncFolderListContainer.innerHTML = `<p class="text-danger">Error loading folders: ${error.message}</p>`;
        }
    }

    if (beatSyncFolderFilterInput) {
        beatSyncFolderFilterInput.addEventListener('input', debounce((e) => {
            const filterText = e.target.value.toLowerCase();
            const filteredFolders = allBeatSyncClipFolders.filter(folder => folder.toLowerCase().includes(filterText));
            renderBeatSyncClipFolderList(filteredFolders);
        }, 250));
    }

    if (beatSyncSelectAllFoldersBtn) {
        beatSyncSelectAllFoldersBtn.addEventListener('click', () => {
            beatSyncFolderListContainer.querySelectorAll('.folder-card-advanced').forEach(card => {
                const cb = card.querySelector('input[type="checkbox"]');
                cb.checked = true;
                card.classList.add('selected');
            });
        });
    }

    if (beatSyncDeselectAllFoldersBtn) {
        beatSyncDeselectAllFoldersBtn.addEventListener('click', () => {
            beatSyncFolderListContainer.querySelectorAll('.folder-card-advanced').forEach(card => {
                const cb = card.querySelector('input[type="checkbox"]');
                cb.checked = false;
                card.classList.remove('selected');
            });
        });
    }

    // --- Audio Drag & Drop Logic ---
    const audioDropZone = document.getElementById('audioDropZone');
    const audioFileNameDisplay = document.getElementById('audioFileNameDisplay');

    if (audioDropZone && audioFileUploadInput) {
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            audioDropZone.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
            });
        });

        ['dragenter', 'dragover'].forEach(eventName => {
            audioDropZone.addEventListener(eventName, () => {
                audioDropZone.classList.add('drag-over');
            });
        });

        ['dragleave', 'drop'].forEach(eventName => {
            audioDropZone.addEventListener(eventName, () => {
                audioDropZone.classList.remove('drag-over');
            });
        });

        audioDropZone.addEventListener('drop', (e) => {
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                const file = files[0];
                if (file.type.match('audio.*')) {
                    audioFileUploadInput.files = files;
                    // Trigger change event manually
                    const event = new Event('change', { bubbles: true });
                    audioFileUploadInput.dispatchEvent(event);
                } else {
                    showToast('Por favor, arrastra solo archivos MP3 o WAV.', 'warning');
                }
            }
        });

        audioDropZone.addEventListener('click', () => {
            audioFileUploadInput.click();
        });
    }

    if (audioFileUploadInput) {
        audioFileUploadInput.addEventListener('change', (event) => {
            const audioFile = event.target.files[0];

            if (audioFile) {
                audioDropZone.classList.add('has-file');
                audioFileNameDisplay.textContent = `🎵 ${audioFile.name}`;
                audioFileNameDisplay.style.display = 'block';
                audioDropZone.querySelector('.drop-zone-content').style.display = 'none';
            } else {
                audioDropZone.classList.remove('has-file');
                audioFileNameDisplay.style.display = 'none';
                audioDropZone.querySelector('.drop-zone-content').style.display = 'block';
            }
            if (audioRangeSlider && audioRangeSlider.noUiSlider) {
                audioRangeSlider.noUiSlider.destroy();
            }
            if (audioPreview) {
                audioPreview.style.display = 'none';
            }
            if (audioFile && audioInfoDiv) {
                audioInfoDiv.textContent = 'Loading audio metadata...';
                const objectUrl = URL.createObjectURL(audioFile);
                if (audioPreview) {
                    audioPreview.src = objectUrl;
                    audioPreview.style.display = 'block';
                }
                const audio = new Audio();
                audio.addEventListener('loadedmetadata', () => {
                    audioDuration = audio.duration;
                    audioInfoDiv.textContent = `Audio duration: ${audioDuration.toFixed(2)} seconds.`;
                    if (audioStartTimeInput) audioStartTimeInput.value = '0';
                    if (audioEndTimeInput) audioEndTimeInput.value = audioDuration.toFixed(2);
                    if (audioRangeSlider) {
                        noUiSlider.create(audioRangeSlider, {
                            start: [0, audioDuration],
                            connect: true,
                            range: { min: 0, max: audioDuration },
                            step: 0.01,
                            tooltips: [true, true],
                            format: wNumb({ decimals: 2 })
                        });
                        audioRangeSlider.noUiSlider.on('update', (values) => {
                            if (audioStartTimeInput) audioStartTimeInput.value = values[0];
                            if (audioEndTimeInput) audioEndTimeInput.value = values[1];
                        });
                        if (audioStartTimeInput) {
                            audioStartTimeInput.addEventListener('input', () => {
                                if (audioRangeSlider.noUiSlider) {
                                    let start = parseFloat(audioStartTimeInput.value) || 0;
                                    const end = parseFloat(audioRangeSlider.noUiSlider.get()[1]);
                                    if (start >= end) {
                                        start = end - 0.01;
                                        audioStartTimeInput.value = start.toFixed(2);
                                    }
                                    audioRangeSlider.noUiSlider.set([start, null]);
                                }
                            });
                        }
                        if (audioEndTimeInput) {
                            audioEndTimeInput.addEventListener('input', () => {
                                if (audioRangeSlider.noUiSlider) {
                                    const start = parseFloat(audioRangeSlider.noUiSlider.get()[0]);
                                    let end = parseFloat(audioEndTimeInput.value) || audioDuration;
                                    if (end <= start) {
                                        end = start + 0.01;
                                        audioEndTimeInput.value = end.toFixed(2);
                                    }
                                    audioRangeSlider.noUiSlider.set([null, end]);
                                }
                            });
                        }
                    }
                    URL.revokeObjectURL(objectUrl);
                });
                audio.addEventListener('error', (err) => {
                    audioInfoDiv.textContent = 'Error loading audio file. Please ensure it is a valid MP3 or WAV file.';
                    console.error('Error loading audio for metadata:', err, audio.error);
                    URL.revokeObjectURL(objectUrl);
                });
                audio.src = objectUrl;
            } else if (audioInfoDiv) {
                audioInfoDiv.textContent = 'Sube un audio para ver su duración.';
            }
        });
    }

    const beatSyncForm = document.getElementById('beatSyncForm');
    const generateBeatSyncVideoBtn = document.getElementById('generateBeatSyncVideoBtn');
    const beatSyncStatus = document.getElementById('beatSyncStatus');
    const beatSyncProgressContainer = document.getElementById('beatSyncProgressContainer');
    const beatSyncProgressBar = document.getElementById('beatSyncProgressBar');
    const beatSyncResult = document.getElementById('beatSyncResult');

    if (beatSyncForm) {
        beatSyncForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const audioFile = audioFileUploadInput.files[0];
            const audioStartTime = parseFloat(document.getElementById('audioStartTime').value) || 0;
            const audioEndTime = parseFloat(document.getElementById('audioEndTime').value);
            const outputVideoNameRaw = document.getElementById('outputVideoName').value.trim();

            const selectedClipFolderCheckboxes = beatSyncFolderListContainer.querySelectorAll('input[type="checkbox"]:checked');
            const selectedClipFolders = Array.from(selectedClipFolderCheckboxes).map(cb => cb.value);

            // --- Validation ---
            if (!audioFile) {
                updateBeatSyncStatus('Please upload an audio file.', true);
                return;
            }
            if (isNaN(audioEndTime) || audioEndTime <= audioStartTime) {
                updateBeatSyncStatus('Audio end time must be greater than start time.', true);
                return;
            }
            if (selectedClipFolders.length === 0) {
                updateBeatSyncStatus('Please select at least one source clip folder.', true);
                return;
            }
            if (!outputVideoNameRaw) {
                updateBeatSyncStatus('Please provide an output video name.', true);
                return;
            }

            let outputVideoName = outputVideoNameRaw;
            if (!/\.(mp4|webm|mkv)$/i.test(outputVideoName)) {
                outputVideoName += '.mp4';
            }

            // --- UI Updates: Disable form, clear status/results, show progress ---
            setFormDisabled(true);
            beatSyncResult.innerHTML = '';
            updateBeatSyncStatus('Preparing...', false, 0);
            beatSyncProgressContainer.style.display = 'block';


            try {
                // --- 1. Audio Analysis ---
                updateBeatSyncStatus('Uploading and analyzing audio...', false, 10);
                const formData = new FormData();
                formData.append('audioFile', audioFile);

                const analyzeResponse = await fetch('/api/audio/analyze', {
                    method: 'POST',
                    body: formData
                });

                if (!analyzeResponse.ok) {
                    const errorData = await analyzeResponse.json().catch(() => ({ error: 'Audio analysis request failed.' }));
                    throw new Error(errorData.error || `Audio analysis failed with status ${analyzeResponse.status}`);
                }

                const analysisData = await analyzeResponse.json();
                if (!analysisData.success || !analysisData.analysis || !analysisData.analysis.beats) {
                    throw new Error(analysisData.error || 'Audio analysis did not return beat data.');
                }

                const beatTimestamps = analysisData.analysis.beats;
                analyzedAudioFileName = analysisData.audioFileName;
                updateBeatSyncStatus('Audio analysis complete. Starting video generation...', false, 30);

                // --- 2. Video Generation ---
                await startVideoGeneration(beatTimestamps, audioStartTime, audioEndTime, selectedClipFolders, outputVideoName, analyzedAudioFileName);

            } catch (error) {
                console.error('Beat Sync Error:', error);
                updateBeatSyncStatus(`Error: ${error.message || 'An unknown error occurred.'}`, true);
                beatSyncProgressContainer.style.display = 'none'; // Hide progress on error
                addToHistory(`Error en Beat Sync: ${error.message}`, 'error');
            } finally {
                setFormDisabled(false); // Re-enable form in case of error or completion
            }
        });
    }

    function setFormDisabled(disabled) {
        if (generateBeatSyncVideoBtn) generateBeatSyncVideoBtn.disabled = disabled;
        if (audioFileUploadInput) audioFileUploadInput.disabled = disabled;
        // Could also disable other inputs like start/end times, folder selection, etc.
        const formElements = beatSyncForm.elements;
        for (let i = 0; i < formElements.length; i++) {
            if (formElements[i].id !== 'generateBeatSyncVideoBtn' && formElements[i].id !== 'audioFileUpload') {
                // formElements[i].disabled = disabled; // Example to disable all
            }
        }
    }

    function updateBeatSyncStatus(message, isError = false, progressPercent = null) {
        if (!beatSyncStatus) return;
        beatSyncStatus.textContent = message;
        beatSyncStatus.className = `alert ${isError ? 'alert-danger' : 'alert-info'}`;
        beatSyncStatus.style.display = 'block';

        if (progressPercent !== null && beatSyncProgressBar && beatSyncProgressContainer) {
            beatSyncProgressContainer.style.display = 'block';
            beatSyncProgressBar.style.width = `${progressPercent}%`;
            beatSyncProgressBar.textContent = `${progressPercent}%`;
            beatSyncProgressBar.setAttribute('aria-valuenow', progressPercent);
        } else if (isError && beatSyncProgressContainer) {
            // Optionally hide progress bar on error or set to 100% with error color
            beatSyncProgressContainer.style.display = 'none';
        }
    }

    async function startVideoGeneration(beatTimestamps, audioStartTime, audioEndTime, sourceClipFolderPaths, outputVideoName, audioFileName) {
        updateBeatSyncStatus('Generating beat-synced video...', false, 40);

        const payload = {
            beatTimestamps,
            audioStartTime,
            audioEndTime,
            sourceClipFolderPaths,
            outputVideoName,
            audioFileName
        };

        const response = await fetch('/api/video/generate-beat-matched', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: 'Video generation request failed.' }));
            throw new Error(errorData.error || `Video generation failed with status ${response.status}`);
        }

        const resultData = await response.json();
        if (!resultData.success || !resultData.videoPath) {
            throw new Error(resultData.error || 'Video generation did not return a valid video path.');
        }

        updateBeatSyncStatus('Video generation complete!', false, 100);
        addToHistory(`Video Beat-Synced creado: ${outputVideoName}`, 'success');

        beatSyncResult.innerHTML = `
            <div class="alert alert-success d-flex align-items-center gap-2 mb-3">
                <i class="bi bi-check-circle-fill"></i>
                <span>¡Video generado con éxito!</span>
            </div>
            <video src="/${resultData.videoPath}" controls class="img-fluid rounded shadow mb-3"></video>
            <p><a href="/${resultData.videoPath}" download="${outputVideoName}" class="btn btn-success d-inline-flex align-items-center gap-2">
                <i class="bi bi-download"></i> Descargar video final
            </a></p>
        `;
    }

    // ----- History & Global UI Handlers -----
    const historyToggle = document.getElementById('historyToggle');
    const closeHistory = document.getElementById('closeHistoryPanel');
    const sidePanel = document.getElementById('activityHistorySidePanel');

    if (historyToggle) {
        historyToggle.addEventListener('click', () => {
            sidePanel.classList.toggle('active');
            renderHistory();
        });
    }

    if (closeHistory) {
        closeHistory.addEventListener('click', () => {
            sidePanel.classList.remove('active');
        });
    }

    // Global Batch Actions
    const deselectBtn = document.getElementById('deselectAllGlobal');
    const deleteBatchBtn = document.getElementById('deleteSelectedGlobal');

    if (deselectBtn) {
        deselectBtn.addEventListener('click', () => {
            selectedClipsMap.clear();
            document.querySelectorAll('.clip-select-checkbox').forEach(cb => cb.checked = false);
            document.querySelectorAll('.clip-selected').forEach(el => el.classList.remove('clip-selected'));
            updateGlobalBatchBar();
        });
    }

    if (deleteBatchBtn) {
        deleteBatchBtn.addEventListener('click', async () => {
            const total = Array.from(selectedClipsMap.values()).reduce((acc, set) => acc + set.size, 0);
            if (!confirm(`¿Eliminar ${total} clips seleccionados?`)) return;

            const videos = Array.from(selectedClipsMap.keys());
            for (const video of videos) {
                await deleteSelectedClips(video);
            }
            updateGlobalBatchBar();
            addToHistory(`Eliminados ${total} clips en lote`, 'warning');
        });
    }

    // ----- Back to Top Button -----
    const backToTopBtn = document.getElementById('backToTop');
    if (backToTopBtn) {
        window.addEventListener('scroll', () => {
            if (window.scrollY > 500) {
                backToTopBtn.style.display = 'block';
            } else {
                backToTopBtn.style.display = 'none';
            }
        });

        backToTopBtn.addEventListener('click', () => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }
});

// Actualizar la caché de videos
function updateAllVideosCache(videos) {
    allDownloadedVideos = videos || [];
}

// Cargar la lista de carpetas disponibles
async function loadFoldersList() {
    try {
        const res = await fetch('/api/download-folders');
        const folders = await res.json();

        const folderSelect = document.getElementById('folderSelect');

        // Mantener la opción "Todos los videos"
        folderSelect.innerHTML = '<option value="" selected>Todos los videos</option>';

        // Añadir las carpetas disponibles
        if (folders && folders.length > 0) {
            folders.forEach(folder => {
                const option = document.createElement('option');
                option.value = folder.path;
                option.textContent = folder.name;
                folderSelect.appendChild(option);
            });
        }

        const storedSelection = localStorage.getItem('selectedFolder');
        if (storedSelection) {
            const exists = Array.from(folderSelect.options).some(opt => opt.value === storedSelection);
            if (exists) {
                folderSelect.value = storedSelection;
            }
        }
    } catch (error) {
        console.error('Error cargando lista de carpetas:', error);
    }
}

// Load video and clip lists from server
async function loadVideoLists() {
    try {
        selectedClipsMap.clear();
        updateGlobalBatchBar();
        renderHistory();

        // Mostrar skeletons mientras carga
        document.getElementById('downloadedVideos').innerHTML = Array(4).fill('<div class="col-md-3 mb-4"><div class="card video-card skeleton" style="height: 300px"></div></div>').join('');
        document.getElementById('generatedClips').innerHTML = Array(4).fill('<div class="col-md-3 mb-4"><div class="card video-card skeleton" style="height: 250px"></div></div>').join('');

        // Load downloaded videos
        const downloadRes = await fetch('/api/downloads');
        const downloads = await downloadRes.json();
        displayDownloadedVideos(downloads);
        updateAllVideosCache(downloads);

        // Load generated clips
        const clipsRes = await fetch('/api/clips');
        const clips = await clipsRes.json();
        displayGeneratedClips(clips);
    } catch (error) {
        console.error('Error loading video lists:', error);
    }
}

// Map technical errors to user-friendly messages
const ERROR_MESSAGES = {
    'Invalid URL': 'La URL proporcionada no es válida. Asegúrate de que sea un enlace de Sakugabooru.',
    'No posts found': 'No se encontraron publicaciones con las etiquetas especificadas.',
    'FFmpeg process exited with code': 'Hubo un problema al procesar el video. Revisa la configuración de clips.',
    'Failed to fetch': 'Error de conexión con el servidor. ¿Está encendido?',
    'Timeout': 'La operación tardó demasiado. Prueba con un rango más pequeño.',
    'ENOENT': 'No se pudo encontrar el archivo especificado.',
    'EACCES': 'Permiso denegado al intentar acceder a los archivos.'
};

function getFriendlyErrorMessage(error) {
    const message = typeof error === 'string' ? error : (error.message || 'Error desconocido');
    for (const [key, friendly] of Object.entries(ERROR_MESSAGES)) {
        if (message.includes(key)) return friendly;
    }
    return message;
}

// Mostrar toast de estado mejorado
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const icons = {
        'success': 'bi-check-circle-fill',
        'danger': 'bi-exclamation-octagon-fill',
        'warning': 'bi-exclamation-triangle-fill',
        'info': 'bi-info-circle-fill'
    };

    const icon = icons[type] || icons.info;
    const friendlyMessage = type === 'danger' ? getFriendlyErrorMessage(message) : message;

    const toastEl = document.createElement('div');
    toastEl.className = `toast align-items-center text-bg-${type} border-0 shadow-lg`;
    toastEl.setAttribute('role', 'alert');
    toastEl.setAttribute('aria-live', 'assertive');
    toastEl.setAttribute('aria-atomic', 'true');

    toastEl.innerHTML = `
        <div class="d-flex p-2">
            <div class="toast-body d-flex align-items-center">
                <i class="bi ${icon} me-2 fs-5"></i>
                <div>${friendlyMessage}</div>
            </div>
            <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
        </div>`;

    container.appendChild(toastEl);
    const toast = new bootstrap.Toast(toastEl, { delay: 5000 });
    toast.show();
    toastEl.addEventListener('hidden.bs.toast', () => toastEl.remove());
}

// Mostrar el estado de la descarga
function showDownloadStatus(message) {
    const statusEl = document.getElementById('downloadStatus');
    statusEl.textContent = message;

    // Mostrar la barra de progreso
    document.querySelector('#download .progress').style.display = 'block';
}

// Mostrar error de descarga
function showDownloadError(message) {
    const statusEl = document.getElementById('downloadStatus');
    statusEl.textContent = `Error: ${message}`;

    // Ocultar la barra de progreso
    document.querySelector('#download .progress').style.display = 'none';

    // Mostrar mensaje de error
    const resultsContainer = document.getElementById('downloadResults');
    const errorDiv = document.createElement('div');
    errorDiv.className = 'alert alert-danger';
    errorDiv.setAttribute('role', 'alert');
    const errIcon = document.createElement('i');
    errIcon.className = 'bi bi-exclamation-triangle';
    errorDiv.appendChild(errIcon);
    errorDiv.appendChild(document.createTextNode(' ' + (message || 'Error')));

    // Insertar al principio
    resultsContainer.insertBefore(errorDiv, resultsContainer.firstChild);

    // Eliminar después de un tiempo
    setTimeout(() => errorDiv.remove(), 10000);
}

// Actualizar la barra de progreso con métricas extendidas
function updateDownloadProgress(percent, key) {
    const progressBar = document.getElementById('downloadProgress');
    if (!progressBar) return;

    progressBar.style.width = `${percent}%`;
    progressBar.setAttribute('aria-valuenow', percent);

    // Calculate metrics
    const download = key ? currentDownloads.get(key) : Array.from(currentDownloads.values())[0];
    const detailedEl = document.getElementById('detailedProgress');
    const speedEl = document.getElementById('progressSpeed');
    const etaEl = document.getElementById('progressEta');

    if (download && download.startTime && percent > 0 && detailedEl) {
        detailedEl.style.display = 'flex';
        detailedEl.style.setProperty('display', 'flex', 'important');

        const elapsed = (Date.now() - download.startTime) / 1000; // seconds
        if (elapsed > 2) {
            const speedPercent = percent / elapsed; // % per second
            const remainingPercent = 100 - percent;
            const etaTotalSeconds = remainingPercent / speedPercent;

            // Format ETA
            let etaText = 'Calculando...';
            if (isFinite(etaTotalSeconds) && etaTotalSeconds >= 0) {
                if (etaTotalSeconds < 60) {
                    etaText = `${Math.round(etaTotalSeconds)}s restantes`;
                } else {
                    const mins = Math.floor(etaTotalSeconds / 60);
                    const secs = Math.round(etaTotalSeconds % 60);
                    etaText = `${mins}m ${secs}s restantes`;
                }
            }
            if (etaEl) etaEl.innerHTML = `<i class="bi bi-clock-history"></i> ${etaText}`;

            // Show artificial speed (since we dont have bytes, we show "percent speed" or just hide speed)
            if (speedEl) speedEl.innerHTML = `<i class="bi bi-speedometer2"></i> ${speedPercent.toFixed(1)}%/s`;
        }
    }
}

// Añadir un resultado de descarga
function addDownloadResult(data) {
    const resultsContainer = document.getElementById('downloadResults');

    const item = document.createElement('div');
    item.className = 'list-group-item list-group-item-success d-flex justify-content-between align-items-center';

    const fileName = data.fileName || data.filePath.split('/').pop();
    // Build icon + filename safely
    const span = document.createElement('span');
    const icon = document.createElement('i');
    icon.className = 'bi bi-check-circle me-2';
    const nameText = document.createTextNode(fileName || '');
    span.appendChild(icon);
    span.appendChild(nameText);
    item.appendChild(span);

    const playBtn = document.createElement('button');
    playBtn.className = 'btn btn-sm btn-primary';
    // Button contents with icon created safely
    const playIcon = document.createElement('i');
    playIcon.className = 'bi bi-play-fill';
    playBtn.appendChild(playIcon);
    playBtn.appendChild(document.createTextNode(' Reproducir'));
    playBtn.setAttribute('aria-label', `Reproducir ${fileName}`);
    playBtn.addEventListener('click', () => {
        openVideoPlayer(`/downloads/${data.filePath}`, fileName);
    });

    item.appendChild(playBtn);

    // Insertar al principio
    resultsContainer.insertBefore(item, resultsContainer.firstChild);
}

// Actualizar la lista de descargas activas
function updateDownloadList() {
    const downloadStatus = document.getElementById('downloadStatus');
    const listContainer = document.getElementById('currentDownloadsList');
    const activeDownloads = Array.from(currentDownloads.values());

    listContainer.innerHTML = '';

    if (activeDownloads.length === 0) {
        if (downloadsInProgress) {
            downloadStatus.textContent = 'Descargas finalizadas';
            downloadsInProgress = false;
        } else {
            downloadStatus.textContent = 'No hay descargas activas';
        }
        document.querySelectorAll('#downloadUrlForm button, #downloadTagsForm button').forEach(btn => btn.disabled = false);
        return;
    }

    document.querySelectorAll('#downloadUrlForm button, #downloadTagsForm button').forEach(btn => btn.disabled = true);

    activeDownloads.forEach(d => {
        const item = document.createElement('div');
        item.className = 'list-group-item d-flex justify-content-between align-items-center';
        const span = document.createElement('span');
        span.textContent = d.message || d.url;
        item.appendChild(span);

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'btn btn-sm btn-danger';
        cancelBtn.textContent = 'Cancelar';
        cancelBtn.setAttribute('aria-label', `Cancelar descarga ${d.url || ''}`.trim());
        if (d.cancelRequested) cancelBtn.disabled = true;
        cancelBtn.addEventListener('click', () => {
            cancelBtn.disabled = true;
            d.cancelRequested = true;
            socket.emit('cancelDownload', { url: d.url });
        });
        item.appendChild(cancelBtn);

        listContainer.appendChild(item);
    });

    const firstActive = activeDownloads.find(d => d.status !== 'complete');
    if (firstActive) {
        downloadStatus.textContent = firstActive.message;
    }
}

// Display downloaded videos in the browser section
function displayDownloadedVideos(videos) {
    const container = document.getElementById('downloadedVideos');
    const noVideosMessage = document.getElementById('noDownloadsMessage');

    container.innerHTML = '';

    if (!videos || videos.length === 0) {
        noVideosMessage.style.display = 'block';
        return;
    }

    noVideosMessage.style.display = 'none';

    // Group videos by directory
    const videosMap = new Map();
    videos.forEach(video => {
        const parts = video.path.split('/');
        const dir = parts.length > 1 ? parts[0] : '';

        if (!videosMap.has(dir)) {
            videosMap.set(dir, []);
        }
        videosMap.get(dir).push(video);
    });

    // Create a card for each directory or standalone video
    videosMap.forEach((dirVideos, dir) => {
        if (dir) {
            // Create directory card
            const dirCol = document.createElement('div');
            dirCol.className = 'col-md-4 mb-4';

            const dirCard = document.createElement('div');
            dirCard.className = 'card folder-item';

            const dirCardBody = document.createElement('div');
            dirCardBody.className = 'card-body';

            const dirTitle = document.createElement('h5');
            dirTitle.className = 'card-title';
            dirTitle.innerHTML = `<i class="bi bi-folder"></i> ${dir} (${dirVideos.length})`;

            const videoList = document.createElement('ul');
            videoList.className = 'list-group mt-3';

            dirVideos.forEach(video => {
                const videoItem = document.createElement('li');
                videoItem.className = 'list-group-item d-flex justify-content-between align-items-center';
                videoItem.textContent = video.name;

                const playBtn = document.createElement('button');
                playBtn.className = 'btn btn-sm btn-primary';
                playBtn.innerHTML = '<i class="bi bi-play-fill"></i>';
                playBtn.setAttribute('aria-label', `Reproducir ${video.name}`);
                playBtn.addEventListener('click', () => {
                    openVideoPlayer(`/downloads/${video.path}`, video.name);
                });

                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'btn btn-sm btn-danger ms-2';
                deleteBtn.innerHTML = '<i class="bi bi-trash"></i>';
                deleteBtn.setAttribute('aria-label', `Eliminar ${video.name}`);
                deleteBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    deleteVideo(video.path);
                });

                videoItem.appendChild(playBtn);
                videoItem.appendChild(deleteBtn);
                videoList.appendChild(videoItem);
            });

            dirCardBody.appendChild(dirTitle);
            dirCardBody.appendChild(videoList);
            dirCard.appendChild(dirCardBody);
            dirCol.appendChild(dirCard);
            container.appendChild(dirCol);
        } else {
            // Create individual video cards
            dirVideos.forEach(video => {
                const videoCol = document.createElement('div');
                videoCol.className = 'col-md-3 mb-4';

                const videoCard = document.createElement('div');
                videoCard.className = 'card video-card';
                videoCard.addEventListener('click', () => {
                    openVideoPlayer(`/downloads/${video.path}`, video.name);
                });

                // Video preview (thumbnail)
                const videoPreview = document.createElement('div');
                videoPreview.className = 'video-thumbnail skeleton d-flex justify-content-center align-items-center bg-dark text-white';
                videoPreview.innerHTML = '<i class="bi bi-play-circle fs-1"></i>';

                // Una vez cargado (simulado o si tuviera thumbnail real), quitamos skeleton
                setTimeout(() => videoPreview.classList.remove('skeleton'), 1000);

                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'delete-video-btn';
                deleteBtn.innerHTML = '<i class="bi bi-trash"></i>';
                deleteBtn.title = 'Eliminar video';
                deleteBtn.setAttribute('aria-label', `Eliminar ${video.name}`);
                deleteBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    deleteVideo(video.path);
                });

                const videoCardBody = document.createElement('div');
                videoCardBody.className = 'card-body';

                const videoTitle = document.createElement('h6');
                videoTitle.className = 'card-title text-truncate';
                videoTitle.textContent = video.name;

                const videoInfo = document.createElement('p');
                videoInfo.className = 'card-text small text-muted';
                videoInfo.textContent = formatFileSize(video.size);

                videoCardBody.appendChild(videoTitle);
                videoCardBody.appendChild(videoInfo);
                videoCard.appendChild(videoPreview);
                videoCard.appendChild(deleteBtn);
                videoCard.appendChild(videoCardBody);
                videoCol.appendChild(videoCard);
                container.appendChild(videoCol);
            });
        }
    });
}

// Configuration for pagination
let CLIPS_PER_PAGE = parseInt(localStorage.getItem('clipsPerPage')) || 12; // Number of clips to show per page for each video

// Store pagination state for each video
let videoPaginationState = new Map();

// Keep track of selected clips for bulk deletion
let selectedClipsMap = new Map();

function sanitizeId(path) {
    return path.replace(/[\\/\.]/g, '-');
}

function updateClipResultsHeader(videoName) {
    const slug = videoName.replace(/[^a-zA-Z0-9]/g, '-');
    const group = document.getElementById(`clips-group-gen-${slug}`);
    if (!group) return;
    const clipCols = group.querySelectorAll(`[data-video-name="${videoName}"]`);
    let totalDuration = 0;
    clipCols.forEach(col => {
        const d = parseFloat(col.dataset.duration || '0');
        if (!isNaN(d)) totalDuration += d;
    });
    const badge = group.querySelector('h5 .badge');
    if (badge) badge.textContent = `${clipCols.length} clips`;
    const durEl = document.getElementById(`duration-gen-${slug}`);
    if (durEl) durEl.textContent = `Duración total: ${Math.round(totalDuration)} segundos`;
}

function updateDeleteSelectedButton(videoName) {
    const slug = videoName.replace(/[^a-zA-Z0-9]/g, '-');
    const btn = document.getElementById(`delete-selected-btn-${slug}`);
    if (!btn) return;
    const set = selectedClipsMap.get(videoName);
    const count = set ? set.size : 0;
    const span = btn.querySelector('.selected-count');
    if (span) span.textContent = count;
    btn.style.display = count > 0 ? 'inline-block' : 'none';
}

function handleClipSelectionChange(videoName, clipPath, isChecked, cardEl) {
    let set = selectedClipsMap.get(videoName);
    if (!set) {
        set = new Set();
        selectedClipsMap.set(videoName, set);
    }
    if (isChecked) {
        set.add(clipPath);
        cardEl.classList.add('clip-selected');
    } else {
        set.delete(clipPath);
        cardEl.classList.remove('clip-selected');
    }
    if (set.size === 0) {
        selectedClipsMap.delete(videoName);
    }
    syncClipSelectionUI(videoName);
    updateDeleteSelectedButton(videoName);
    updateGlobalBatchBar();
}

function getClipElementsForVideo(videoName) {
    return Array.from(document.querySelectorAll('[data-video-name]'))
        .filter(el => el.dataset.videoName === videoName);
}

function syncClipSelectionUI(videoName) {
    const set = selectedClipsMap.get(videoName);
    getClipElementsForVideo(videoName).forEach(clipEl => {
        const clipPath = clipEl.dataset.clipPath;
        if (!clipPath) return;
        const checkbox = clipEl.querySelector('.clip-select-checkbox');
        const card = clipEl.querySelector('.card');
        const isSelected = !!(set && set.has(clipPath));
        if (checkbox) {
            checkbox.checked = isSelected;
        }
        if (card) {
            card.classList.toggle('clip-selected', isSelected);
        }
    });
}

function selectAllClipsForVideo(videoName, clipPaths = []) {
    const normalizedPaths = Array.isArray(clipPaths) && clipPaths.length
        ? clipPaths
        : getClipElementsForVideo(videoName)
            .map(el => el.dataset.clipPath)
            .filter(Boolean);

    if (normalizedPaths.length === 0) return;

    selectedClipsMap.set(videoName, new Set(normalizedPaths));
    syncClipSelectionUI(videoName);
    updateDeleteSelectedButton(videoName);
    updateGlobalBatchBar();
}

async function deleteSelectedClips(videoName) {
    const set = selectedClipsMap.get(videoName);
    if (!set || set.size === 0) return;
    const paths = Array.from(set);
    await Promise.all(paths.map(p => {
        const id1 = `clip-container-${sanitizeId(p)}`;
        const id2 = `clip-container-gen-${sanitizeId(p)}`;
        const elementId = document.getElementById(id1) ? id1 : (document.getElementById(id2) ? id2 : null);
        return deleteClip(p, elementId);
    }));
    selectedClipsMap.delete(videoName);
    syncClipSelectionUI(videoName);
    updateDeleteSelectedButton(videoName);
}

// Display generated clips in the browser section with pagination
function displayGeneratedClips(clips) {
    const container = document.getElementById('generatedClips');
    const noClipsMessage = document.getElementById('noClipsMessage');

    container.innerHTML = '';

    if (!clips || clips.length === 0) {
        noClipsMessage.style.display = 'block';
        return;
    }

    noClipsMessage.style.display = 'none';

    // Group clips by parent directory/video
    const clipsMap = new Map();

    clips.forEach(clip => {
        const pathParts = clip.path.split('/');
        const parentDir = pathParts.length > 1 ? pathParts[0] : 'other';

        if (!clipsMap.has(parentDir)) {
            clipsMap.set(parentDir, []);
        }
        clipsMap.get(parentDir).push(clip);
    });

    // Process each group of clips
    clipsMap.forEach((videoClips, videoName) => {
        // Initialize pagination state for this video if not exists
        if (!videoPaginationState.has(videoName)) {
            videoPaginationState.set(videoName, { currentPage: 1 });
        }

        let currentPage = videoPaginationState.get(videoName).currentPage;
        const totalPages = Math.ceil(videoClips.length / CLIPS_PER_PAGE);
        const totalDuration = videoClips.reduce((sum, c) => sum + (c.duration || 0), 0);
        const clipPathsForVideo = videoClips.map(clip => clip.path);

        // Adjust current page if it's now invalid (happens when deleting clips)
        if (currentPage > totalPages && totalPages > 0) {
            currentPage = totalPages;
            videoPaginationState.set(videoName, { currentPage: currentPage });
        }

        const startIndex = (currentPage - 1) * CLIPS_PER_PAGE;
        const endIndex = startIndex + CLIPS_PER_PAGE;
        const currentClips = videoClips.slice(startIndex, endIndex);

        // Create video section container
        const videoSection = document.createElement('div');
        videoSection.className = 'video-section mb-4';
        videoSection.id = `video-section-${videoName.replace(/[^a-zA-Z0-9]/g, '-')}`;

        // Add header for this video's clips with clip count
        const headerRow = document.createElement('div');
        headerRow.className = 'row mb-2 mt-4';
        const slug = videoName.replace(/[^a-zA-Z0-9]/g, '-');
        headerRow.innerHTML = `
            <div class="col-12 d-flex justify-content-between align-items-center">
                <div>
                    <h5 class="mb-0 d-inline">${videoName} <span class="badge bg-secondary">${videoClips.length} clips</span></h5>
                    <button class="btn btn-sm btn-danger ms-2 delete-all-clips-btn" data-folder="${videoName}" title="Borrar todos los clips">
                        <i class="bi bi-trash"></i>
                    </button>
                    <button class="btn btn-sm btn-outline-primary ms-2 select-all-clips-btn" data-video="${videoName}" title="Seleccionar todos los clips">
                        <i class="bi bi-check2-all"></i> Seleccionar todos
                    </button>
                    <button class="btn btn-sm btn-warning ms-2 delete-selected-btn" id="delete-selected-btn-${slug}" style="display:none;">
                        <i class="bi bi-trash"></i> Eliminar seleccionados (<span class="selected-count">0</span>)
                    </button>
                    <div><small class="text-muted">Duración total: ${Math.round(totalDuration)} segundos</small></div>
                </div>
                <div class="pagination-info">
                    <small class="text-muted">Página ${currentPage} de ${totalPages}</small>
                </div>
            </div>
        `;
        videoSection.appendChild(headerRow);

        const deleteAllBtn = headerRow.querySelector('.delete-all-clips-btn');
        if (deleteAllBtn) {
            deleteAllBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const folder = deleteAllBtn.getAttribute('data-folder');
                if (folder) {
                    deleteClipsFolder(folder, `#${videoSection.id}`);
                }
            });
        }

        const deleteSelectedBtn = headerRow.querySelector('.delete-selected-btn');
        if (deleteSelectedBtn) {
            deleteSelectedBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                deleteSelectedClips(videoName);
            });
        }

        const selectAllBtn = headerRow.querySelector('.select-all-clips-btn');
        if (selectAllBtn) {
            selectAllBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                selectAllClipsForVideo(videoName, clipPathsForVideo);
            });
        }

        // Create pagination controls if needed
        if (totalPages > 1) {
            const paginationTop = createPaginationControls(videoName, currentPage, totalPages, 'top');
            videoSection.appendChild(paginationTop);
        }

        // Create a row for this video's clips
        const clipsRow = document.createElement('div');
        clipsRow.className = 'row mb-3';
        clipsRow.id = `clips-group-${videoName.replace(/[^a-zA-Z0-9]/g, '-')}`;

        // Only render current page clips
        currentClips.forEach((clip, index) => {
            const clipCol = createClipElement(clip, startIndex + index);
            clipsRow.appendChild(clipCol);
        });

        videoSection.appendChild(clipsRow);

        // Add bottom pagination controls if needed
        if (totalPages > 1) {
            const paginationBottom = createPaginationControls(videoName, currentPage, totalPages, 'bottom');
            videoSection.appendChild(paginationBottom);
        }

        container.appendChild(videoSection);
    });
}

// Create a clip element (extracted for reusability)
function createClipElement(clip, globalIndex) {
    const clipCol = document.createElement('div');
    clipCol.className = 'col-md-3 mb-4';
    clipCol.id = `clip-container-${clip.path.replace(/[\\/\.]/g, '-')}`;
    clipCol.dataset.clipPath = clip.path;
    const videoNameForSel = clip.path.split('/')[0];
    clipCol.dataset.videoName = videoNameForSel;
    if (typeof clip.size === 'number') {
        clipCol.dataset.size = String(clip.size);
    }
    if (typeof clip.duration === 'number') {
        clipCol.dataset.duration = clip.duration;
    }

    const clipCard = document.createElement('div');
    clipCard.className = 'card video-card position-relative';

    const selectBox = document.createElement('input');
    selectBox.type = 'checkbox';
    selectBox.className = 'form-check-input clip-select-checkbox';
    clipCard.appendChild(selectBox);

    const selectedSet = selectedClipsMap.get(videoNameForSel);
    if (selectedSet && selectedSet.has(clip.path)) {
        selectBox.checked = true;
        clipCard.classList.add('clip-selected');
    }

    selectBox.addEventListener('change', () => {
        handleClipSelectionChange(videoNameForSel, clip.path, selectBox.checked, clipCard);
    });

    // Video preview (thumbnail)
    const videoContainer = document.createElement('div');
    videoContainer.className = 'video-container skeleton'; // Start with skeleton

    // Create video element with lazy loading
    const videoElement = document.createElement('video');
    videoElement.className = 'w-100';
    videoElement.style.opacity = '0'; // Hide until loaded
    videoElement.src = `/clips/${clip.path}`;
    videoElement.preload = 'none';
    videoElement.muted = true;
    videoElement.loop = true;    // Lazy loading: start loading and autoplay when video comes into view
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                videoElement.preload = 'metadata';
                // Autoplay when the video comes into view
                videoElement.addEventListener('loadeddata', () => {
                    videoElement.style.opacity = '1';
                    videoContainer.classList.remove('skeleton'); // Remove skeleton on load
                    videoElement.play().catch(error => {
                        console.log('Autoplay prevented:', error);
                    });
                }, { once: true });
                observer.unobserve(videoElement);
            }
        });
    }, { rootMargin: '200px' });
    observer.observe(videoElement);    // Event listener for video click to toggle play/pause
    videoElement.addEventListener('click', () => {
        const container = videoElement.closest('.video-container');

        if (videoElement.paused) {
            videoElement.play().catch(error => {
                console.log('Play prevented:', error);
            });
            // Show play icon feedback
            if (container) {
                container.classList.add('show-play-icon');
                setTimeout(() => {
                    container.classList.remove('show-play-icon');
                }, 800);
            }
        } else {
            videoElement.pause();
            // Show pause icon feedback
            if (container) {
                container.classList.add('show-pause-icon');
                setTimeout(() => {
                    container.classList.remove('show-pause-icon');
                }, 800);
            }
        }
    });

    // Add event listeners for visual feedback
    videoElement.addEventListener('play', () => {
        videoElement.removeAttribute('paused');
    });

    videoElement.addEventListener('pause', () => {
        videoElement.setAttribute('paused', 'true');
    });

    // Add visual indicator on hover for better UX
    videoElement.addEventListener('mouseenter', () => {
        if (!videoElement.paused) {
            videoElement.style.opacity = '0.9';
        }
    });

    videoElement.addEventListener('mouseleave', () => {
        videoElement.style.opacity = '';
    });

    // Delete button
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-clip-btn';
    deleteBtn.innerHTML = '<i class="bi bi-trash"></i>';
    deleteBtn.title = 'Eliminar clip';
    deleteBtn.setAttribute('data-clip-path', clip.path);

    // Event for delete button - stop propagation
    deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteClip(clip.path, clipCol.id);
    });

    videoContainer.appendChild(videoElement);
    clipCard.appendChild(videoContainer);
    clipCard.appendChild(deleteBtn);

    // Card body with clip info
    const clipCardBody = document.createElement('div');
    clipCardBody.className = 'card-body';

    const clipTitle = document.createElement('h6');
    clipTitle.className = 'card-title text-truncate';
    clipTitle.textContent = clip.name;

    const clipInfo = document.createElement('p');
    clipInfo.className = 'card-text small text-muted';
    const sizeLabel = formatFileSize(typeof clip.size === 'number' ? clip.size : 0);
    const durationLabel = typeof clip.duration === 'number' ? formatDuration(clip.duration) : '';
    clipInfo.textContent = durationLabel ? `${sizeLabel} | ${durationLabel}` : sizeLabel;

    // Play video when clicking on the card
    clipCard.addEventListener('click', (e) => {
        if (e.target !== deleteBtn && !deleteBtn.contains(e.target) && !videoElement.contains(e.target)) {
            if (videoElement.paused) {
                videoElement.play();
            } else {
                videoElement.pause();
            }
        }
    });

    clipCardBody.appendChild(clipTitle);
    clipCardBody.appendChild(clipInfo);
    clipCard.appendChild(clipCardBody);
    clipCol.appendChild(clipCard);

    // Set video to half volume by default
    videoElement.volume = 0.5;

    return clipCol;
}

// Create pagination controls
function createPaginationControls(videoName, currentPage, totalPages, position) {
    const paginationContainer = document.createElement('div');
    paginationContainer.className = `pagination-container mb-3 ${position}`;

    const pagination = document.createElement('nav');
    pagination.innerHTML = `
        <ul class="pagination pagination-sm justify-content-center">
            <li class="page-item ${currentPage === 1 ? 'disabled' : ''}">
                <a class="page-link" href="#" data-video="${videoName}" data-page="${currentPage - 1}">
                    <i class="bi bi-chevron-left"></i>
                </a>
            </li>
            ${generatePageNumbers(videoName, currentPage, totalPages)}
            <li class="page-item ${currentPage === totalPages ? 'disabled' : ''}">
                <a class="page-link" href="#" data-video="${videoName}" data-page="${currentPage + 1}">
                    <i class="bi bi-chevron-right"></i>
                </a>
            </li>
        </ul>
    `;

    // Add event listeners to pagination links
    pagination.querySelectorAll('.page-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const video = link.dataset.video;
            const page = parseInt(link.dataset.page);

            if (video && page && !link.parentElement.classList.contains('disabled')) {
                changeVideoPage(video, page);
            }
        });
    });

    paginationContainer.appendChild(pagination);
    return paginationContainer;
}

// Generate page numbers for pagination
function generatePageNumbers(videoName, currentPage, totalPages) {
    let pages = '';

    // Show page numbers with ellipsis logic
    let startPage = Math.max(1, currentPage - 2);
    let endPage = Math.min(totalPages, currentPage + 2);

    // Adjust range if we're near the beginning or end
    if (currentPage <= 3) {
        endPage = Math.min(5, totalPages);
    }
    if (currentPage > totalPages - 3) {
        startPage = Math.max(totalPages - 4, 1);
    }

    // Add first page and ellipsis if needed
    if (startPage > 1) {
        pages += `<li class="page-item">
            <a class="page-link" href="#" data-video="${videoName}" data-page="1">1</a>
        </li>`;
        if (startPage > 2) {
            pages += `<li class="page-item disabled"><span class="page-link">...</span></li>`;
        }
    }

    // Add page numbers
    for (let i = startPage; i <= endPage; i++) {
        pages += `<li class="page-item ${i === currentPage ? 'active' : ''}">
            <a class="page-link" href="#" data-video="${videoName}" data-page="${i}">${i}</a>
        </li>`;
    }

    // Add last page and ellipsis if needed
    if (endPage < totalPages) {
        if (endPage < totalPages - 1) {
            pages += `<li class="page-item disabled"><span class="page-link">...</span></li>`;
        }
        pages += `<li class="page-item">
            <a class="page-link" href="#" data-video="${videoName}" data-page="${totalPages}">${totalPages}</a>
        </li>`;
    }

    return pages;
}

// Change page for a specific video
function changeVideoPage(videoName, newPage) {
    // Show loading indicator
    const videoSection = document.getElementById(`video-section-${videoName.replace(/[^a-zA-Z0-9]/g, '-')}`);
    if (videoSection) {
        videoSection.style.opacity = '0.7';
        videoSection.style.pointerEvents = 'none';
    }

    // Update pagination state
    videoPaginationState.set(videoName, { currentPage: newPage });

    // Refresh the display - only reload clips data
    loadVideoLists().then(() => {
        // Restore video section
        if (videoSection) {
            videoSection.style.opacity = '1';
            videoSection.style.pointerEvents = 'auto';
        }

        // Scroll to the video section
        setTimeout(() => {
            const newVideoSection = document.getElementById(`video-section-${videoName.replace(/[^a-zA-Z0-9]/g, '-')}`);
            if (newVideoSection) {
                newVideoSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }, 100);
    });
}



// Function to delete a clip
async function deleteClip(clipPath, elementId) {
    try {
        const response = await fetch('/api/delete-clip', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ clipPath })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Error al eliminar el clip');
        }

        // Show success feedback
        console.log(`Clip eliminado: ${clipPath}`);

        // Remove the clip element from the DOM if an ID was provided
        if (elementId) {
            const el = document.getElementById(elementId);
            if (el) {
                el.remove();
            }
        }

        // Extract video name from clip path for pagination management
        const pathParts = clipPath.split('/');
        const videoName = pathParts.length > 1 ? pathParts[0] : 'other';

        const set = selectedClipsMap.get(videoName);
        if (set) {
            set.delete(clipPath);
            if (set.size === 0) {
                selectedClipsMap.delete(videoName);
            }
        }
        syncClipSelectionUI(videoName);
        updateDeleteSelectedButton(videoName);
        updateClipResultsHeader(videoName);

        // Get current pagination state for this video
        const currentState = videoPaginationState.get(videoName);

        // Refresh the video lists to get updated clip count
        await loadVideoLists();

        // If we had pagination state, try to maintain the current page or adjust if needed
        if (currentState) {
            // The loadVideoLists() call will handle pagination automatically
            // If the current page becomes empty, it will adjust to the previous page
        }

        // Show temporary success message
        const statusEl = document.getElementById('generationStatus');
        if (statusEl) {
            const originalText = statusEl.textContent;
            statusEl.textContent = 'Clip eliminado exitosamente';
            statusEl.style.color = '#28a745';

            setTimeout(() => {
                statusEl.textContent = originalText;
                statusEl.style.color = '';
            }, 2000);
        }

    } catch (error) {
        console.error('Error al eliminar clip:', error);
        alert(`Error: ${error.message}`);
    }
}

// Function to delete a downloaded video
async function deleteVideo(videoPath) {
    try {
        const response = await fetch('/api/delete-video', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ videoPath })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Error al eliminar el video');
        }

        console.log(`Video eliminado: ${videoPath}`);

        await loadVideoLists();

        const statusEl = document.getElementById('downloadStatus');
        if (statusEl) {
            const originalText = statusEl.textContent;
            statusEl.textContent = 'Video eliminado exitosamente';
            statusEl.style.color = '#28a745';

            setTimeout(() => {
                statusEl.textContent = originalText;
                statusEl.style.color = '';
            }, 2000);
        }

    } catch (error) {
        console.error('Error al eliminar video:', error);
        alert(`Error: ${error.message}`);
    }
}

// Function to delete all clips inside a folder (video)
async function deleteClipsFolder(folderPath, removeSelector) {
    try {
        const response = await fetch('/api/delete-clips-folder', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ folderPath })
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'Error al eliminar los clips');
        }

        console.log(`Carpeta de clips eliminada: ${folderPath}`);
        const groupEl = removeSelector ? document.querySelector(removeSelector) : null;
        if (groupEl) {
            groupEl.remove();
        }
        videoPaginationState.delete(folderPath);
        await loadVideoLists();
    } catch (error) {
        console.error('Error al eliminar carpeta de clips:', error);
        alert(`Error: ${error.message}`);
    }
}

// Setup the video player modal
function setupVideoPlayer() {
    const videoPlayerModal = new bootstrap.Modal(document.getElementById('videoPlayerModal'));
    const videoPlayer = document.getElementById('videoPlayer');

    document.getElementById('videoPlayerModal').addEventListener('hidden.bs.modal', () => {
        videoPlayer.pause();
        videoPlayer.src = '';
    });
}

// Open video player with specified source
function openVideoPlayer(videoSrc, title) {
    const modal = document.getElementById('videoPlayerModal');
    const videoPlayer = document.getElementById('videoPlayer');
    const videoTitle = document.getElementById('videoPlayerTitle');

    videoPlayer.src = videoSrc;
    videoTitle.textContent = title || 'Reproductor de video';

    const modalInstance = bootstrap.Modal.getInstance(modal) || new bootstrap.Modal(modal);
    modalInstance.show();
}

// Start downloading a video or videos by tags
async function startDownload(params) {
    const statusEl = document.getElementById('downloadStatus');
    const progressContainer = document.querySelector('#download .progress');
    const progressBar = document.getElementById('downloadProgress');
    const resultsContainer = document.getElementById('downloadResults');

    try {
        // Show progress indicators
        statusEl.textContent = 'Iniciando descarga...';
        progressContainer.style.display = 'block';
        progressBar.style.width = '10%';
        progressBar.setAttribute('aria-valuenow', 10);

        let endpoint, requestBody;

        if (params.url) {
            endpoint = '/api/download';
            requestBody = { url: params.url };
        } else if (params.tags) {
            endpoint = '/api/download-by-tags';
            requestBody = { tags: params.tags };
        } else {
            throw new Error('Se requiere URL o etiquetas para la descarga');
        }

        // Send download request
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Error en la descarga');
        }

        // La respuesta ahora es inmediata, y el progreso se mostrará a través de WebSockets
        statusEl.textContent = data.message || 'Descarga iniciada con éxito';

    } catch (error) {
        console.error('Error en la descarga:', error);
        statusEl.textContent = `Error: ${error.message}`;
        progressContainer.style.display = 'none';

        resultsContainer.innerHTML = `<div class="alert alert-danger">
            <i class="bi bi-exclamation-triangle"></i> ${error.message}
        </div>`;
    }
}

function buildClipInfoMap(clipInfos) {
    const infoMap = new Map();
    if (!Array.isArray(clipInfos)) return infoMap;

    clipInfos.forEach(info => {
        if (!info || !info.path) return;
        const rel = info.path.replace(/^output\/clips\//, '');
        infoMap.set(rel, {
            duration: typeof info.duration === 'number' ? info.duration : 0,
            size: typeof info.size === 'number' ? info.size : 0
        });
    });

    return infoMap;
}

// Generate clips from a video
async function generateClips(videoPath, sceneOptions = {}) {
    const statusEl = document.getElementById('generationStatus');
    const progressContainer = document.querySelector('#generate .progress');
    const progressBar = document.getElementById('generationProgress');
    const resultsContainer = document.getElementById('clipResults');

    try {
        // Show progress indicators
        statusEl.textContent = 'Iniciando generación de clips...';
        progressContainer.style.display = 'block';
        progressBar.style.width = '20%';
        resultsContainer.innerHTML = '';

        // Send generate request
        const response = await fetch('/api/generate-clips', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                videoPath,
                ...sceneOptions
            })
        });

        // Update progress
        progressBar.style.width = '80%';

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Error en la generación de clips');
        }

        // Show success status
        progressBar.style.width = '100%';
        statusEl.textContent = `Generación de clips completada: ${data.clipPaths.length} clips creados`;
        addToHistory(`Generados ${data.clipPaths.length} clips de ${videoPath.split('/').pop()}`, 'success');

        // Display clip results
        if (data.clipPaths && data.clipPaths.length > 0) {
            const videoName = videoPath.split('/').pop();
            const folderName = videoName.replace(/\.[^/.]+$/, '');

            const totalDuration = Array.isArray(data.clipInfos)
                ? data.clipInfos.reduce((sum, c) => sum + (c.duration || 0), 0)
                : 0;
            const relativeClipPaths = data.clipPaths.map(path => path.replace(/^output\/clips\//, ''));

            const group = document.createElement('div');
            group.id = `clips-group-gen-${folderName.replace(/[^a-zA-Z0-9]/g, '-')}`;

            const headerRow = document.createElement('div');
            headerRow.className = 'row mb-2';
            const slugGen = folderName.replace(/[^a-zA-Z0-9]/g, '-');
            headerRow.innerHTML = `
                <div class="col-12 d-flex justify-content-between align-items-center">
                    <div>
                        <h5 class="mb-0 d-inline">${videoName} <span class="badge bg-secondary">${data.clipPaths.length} clips</span></h5>
                        <button class="btn btn-sm btn-danger ms-2 delete-all-clips-btn" data-folder="${folderName}" title="Borrar todos los clips">
                            <i class="bi bi-trash"></i>
                        </button>
                        <button class="btn btn-sm btn-outline-primary ms-2 select-all-clips-btn" data-video="${folderName}" title="Seleccionar todos los clips">
                            <i class="bi bi-check2-all"></i> Seleccionar todos
                        </button>
                        <button class="btn btn-sm btn-warning ms-2 delete-selected-btn" id="delete-selected-btn-${slugGen}" style="display:none;">
                            <i class="bi bi-trash"></i> Eliminar seleccionados (<span class="selected-count">0</span>)
                        </button>
                        <div><small id="duration-gen-${slugGen}" class="text-muted">Duración total: ${Math.round(totalDuration)} segundos</small></div>
                    </div>
                </div>`;
            group.appendChild(headerRow);

            const deleteAllBtn = headerRow.querySelector('.delete-all-clips-btn');
            if (deleteAllBtn) {
                deleteAllBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    deleteClipsFolder(folderName, `#${group.id}`);
                });
            }

            const deleteSelectedBtn = headerRow.querySelector('.delete-selected-btn');
            if (deleteSelectedBtn) {
                deleteSelectedBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    deleteSelectedClips(folderName);
                });
            }
            const selectAllBtn = headerRow.querySelector('.select-all-clips-btn');
            if (selectAllBtn) {
                selectAllBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    selectAllClipsForVideo(folderName, relativeClipPaths);
                });
            }

            const clipsRow = document.createElement('div');
            clipsRow.className = 'row mb-4';
            group.appendChild(clipsRow);

            const infoMap = buildClipInfoMap(data.clipInfos);

            relativeClipPaths.forEach(clipRelPath => {
                const clipName = clipRelPath.split('/').pop();
                const clipInfo = infoMap.get(clipRelPath) || {};
                const clipObj = {
                    path: clipRelPath,
                    name: clipName,
                    size: typeof clipInfo.size === 'number' ? clipInfo.size : 0,
                    duration: typeof clipInfo.duration === 'number' ? clipInfo.duration : 0
                };
                const clipCol = createClipElement(clipObj, 0);
                clipCol.classList.remove('col-md-3');
                clipCol.classList.add('col-md-4');
                clipsRow.appendChild(clipCol);
            });

            resultsContainer.appendChild(group);
        } else {
            resultsContainer.innerHTML = '<div class="alert alert-warning">No se generaron clips</div>';
        }

        // Refresh video lists
        loadVideoLists();

        // Reset progress after a delay
        setTimeout(() => {
            progressContainer.style.display = 'none';
            progressBar.style.width = '0%';
        }, 3000);

    } catch (error) {
        console.error('Error en la generación de clips:', error);
        statusEl.textContent = `Error: ${error.message}`;
        progressContainer.style.display = 'none';

        resultsContainer.innerHTML = `<div class="alert alert-danger">
            <i class="bi bi-exclamation-triangle"></i> ${error.message}
        </div>`;
    }
}

// Generate clips from all videos in a folder
async function generateClipsFromFolder(folderPath, sceneOptions = {}) {
    const statusEl = document.getElementById('generationStatus');
    const progressContainer = document.querySelector('#generate .progress');
    const progressBar = document.getElementById('generationProgress');
    const resultsContainer = document.getElementById('clipResults');

    try {
        // Show progress indicators
        statusEl.textContent = 'Iniciando generación de clips para todos los videos de la carpeta...';
        progressContainer.style.display = 'block';
        progressBar.style.width = '10%';
        resultsContainer.innerHTML = '';

        // Send generate request for all videos in folder
        const response = await fetch('/api/generate-clips-from-folder', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                folderPath,
                ...sceneOptions
            })
        });

        // Update progress
        progressBar.style.width = '50%';

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Error en la generación de clips');
        }

        // Show success status
        progressBar.style.width = '100%';

        const totalClips = data.results.reduce((total, result) => total + (result.clipPaths?.length || 0), 0);
        statusEl.textContent = `Generación de clips completada: ${totalClips} clips creados de ${data.results.length} videos`;

        // Display clip results
        if (data.results.length > 0) {
            data.results.forEach(result => {
                if (result.clipPaths && result.clipPaths.length > 0) {
                    // Add a header for each video's clips
                    const videoName = result.videoPath.split('/').pop();
                    const folderName = videoName.replace(/\.[^/.]+$/, '');

                    const totalDuration = Array.isArray(result.clipInfos)
                        ? result.clipInfos.reduce((sum, c) => sum + (c.duration || 0), 0)
                        : 0;
                    const relativeClipPaths = result.clipPaths.map(path => path.replace(/^output\/clips\//, ''));

                    const group = document.createElement('div');
                    group.id = `clips-group-gen-${folderName.replace(/[^a-zA-Z0-9]/g, '-')}`;

                    const headerRow = document.createElement('div');
                    headerRow.className = 'row mb-2';
                    const slugFolder = folderName.replace(/[^a-zA-Z0-9]/g, '-');
                    headerRow.innerHTML = `
                        <div class="col-12 d-flex justify-content-between align-items-center">
                            <div>
                                <h5 class="mb-0 d-inline">${videoName} <span class="badge bg-secondary">${result.clipPaths.length} clips</span></h5>
                                <button class="btn btn-sm btn-danger ms-2 delete-all-clips-btn" data-folder="${folderName}" title="Borrar todos los clips">
                                    <i class="bi bi-trash"></i>
                                </button>
                                <button class="btn btn-sm btn-outline-primary ms-2 select-all-clips-btn" data-video="${folderName}" title="Seleccionar todos los clips">
                                    <i class="bi bi-check2-all"></i> Seleccionar todos
                                </button>
                                <button class="btn btn-sm btn-warning ms-2 delete-selected-btn" id="delete-selected-btn-${slugFolder}" style="display:none;">
                                    <i class="bi bi-trash"></i> Eliminar seleccionados (<span class="selected-count">0</span>)
                                </button>
                                <div><small id="duration-gen-${slugFolder}" class="text-muted">Duración total: ${Math.round(totalDuration)} segundos</small></div>
                            </div>
                        </div>`;
                    group.appendChild(headerRow);

                    const deleteAllBtn = headerRow.querySelector('.delete-all-clips-btn');
                    if (deleteAllBtn) {
                        deleteAllBtn.addEventListener('click', (e) => {
                            e.stopPropagation();
                            deleteClipsFolder(folderName, `#${group.id}`);
                        });
                    }

                    const deleteSelectedBtn = headerRow.querySelector('.delete-selected-btn');
                    if (deleteSelectedBtn) {
                        deleteSelectedBtn.addEventListener('click', (e) => {
                            e.stopPropagation();
                            deleteSelectedClips(folderName);
                        });
                    }
                    const selectAllBtn = headerRow.querySelector('.select-all-clips-btn');
                    if (selectAllBtn) {
                        selectAllBtn.addEventListener('click', (e) => {
                            e.stopPropagation();
                            selectAllClipsForVideo(folderName, relativeClipPaths);
                        });
                    }

                    // Create a row for the clips
                    const clipsRow = document.createElement('div');
                    clipsRow.className = 'row mb-4';
                    group.appendChild(clipsRow);
                    clipsRow.id = `clips-group-gen-${folderName.replace(/[^a-zA-Z0-9]/g, '-')}`;

                    const infoMap = buildClipInfoMap(result.clipInfos);

                    relativeClipPaths.forEach(clipRelPath => {
                        const clipName = clipRelPath.split('/').pop();
                        const clipInfo = infoMap.get(clipRelPath) || {};
                        const clipObj = {
                            path: clipRelPath,
                            name: clipName,
                            size: typeof clipInfo.size === 'number' ? clipInfo.size : 0,
                            duration: typeof clipInfo.duration === 'number' ? clipInfo.duration : 0
                        };
                        const clipCol = createClipElement(clipObj, 0);
                        clipCol.classList.remove('col-md-3');
                        clipCol.classList.add('col-md-4');
                        clipsRow.appendChild(clipCol);
                    });

                    resultsContainer.appendChild(group);
                }
            });
        } else {
            resultsContainer.innerHTML = '<div class="alert alert-warning">No se generaron clips</div>';
        }

        // Refresh video lists
        loadVideoLists();

        // Reset progress after a delay
        setTimeout(() => {
            progressContainer.style.display = 'none';
            progressBar.style.width = '0%';
        }, 3000);

    } catch (error) {
        console.error('Error en la generación de clips:', error);
        statusEl.textContent = `Error: ${error.message}`;
        progressContainer.style.display = 'none';

        resultsContainer.innerHTML = `<div class="alert alert-danger">
            <i class="bi bi-exclamation-triangle"></i> ${error.message}
        </div>`;
    }
}

// Format file size to human-readable format
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatDuration(seconds) {
    if (seconds === undefined || seconds === null || isNaN(seconds)) return '0s';

    const totalSeconds = Math.max(0, Math.round(seconds));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;

    const parts = [];
    if (hours) parts.push(`${hours}h`);
    if (minutes || hours) parts.push(`${minutes}m`);
    parts.push(`${secs}s`);

    return parts.join(' ');
}
