document.addEventListener('DOMContentLoaded', () => {
    // Conexión de Socket.IO
    const socket = io();

    // Variables globales
    let currentDownloads = new Map();
    let allDownloadedVideos = [];
    let downloadsInProgress = false;

    // Tab navigation
    const navLinks = document.querySelectorAll('.navbar-nav .nav-link');
    const sections = document.querySelectorAll('.section-content');

    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const targetSectionId = link.dataset.section;

            // Hide all sections and remove active class from nav links
            sections.forEach(section => section.classList.remove('active'));
            navLinks.forEach(navLink => navLink.classList.remove('active'));

            // Show target section and set active class on clicked link
            const targetSectionElement = document.getElementById(targetSectionId);
            if (targetSectionElement) {
                targetSectionElement.classList.add('active');
            }
            link.classList.add('active');

            // If the rename-clips tab is activated, fetch its folders
            if (targetSectionId === 'rename-clips') {
                fetchAndDisplayClipFolders();
            } else if (targetSectionId === 'beat-sync') {
                fetchAndDisplayBeatSyncClipFolders(); // Function to be added later
            }
        });
    });

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

    // Initialize video lists
    loadVideoLists();
    loadFoldersList();

    // Folder selection change event
    document.getElementById('folderSelect').addEventListener('change', (e) => {
        // Ya no necesitamos actualizar el selector de videos
    });

    // Download URL form submission
    document.getElementById('downloadUrlForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const url = document.getElementById('downloadUrl').value.trim();
        if (!url) return;

        await startDownload({ url });
    });

    // Download tags form submission
    document.getElementById('downloadTagsForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const tagsText = document.getElementById('downloadTags').value.trim();
        if (!tagsText) return;

        const tags = tagsText.split(';')
            .map(tag => tag.trim())
            .filter(tag => tag.length > 0);

        await startDownload({ tags });
    });

    // Generate clips form submission
    document.getElementById('generateClipsForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const folderPath = document.getElementById('folderSelect').value;
        if (!folderPath) return;

        const minDuration = parseFloat(document.getElementById('minDuration').value) || 1.0;
        const maxDuration = parseFloat(document.getElementById('maxDuration').value) || 3.0;
        const threshold = parseFloat(document.getElementById('threshold').value) || 30;
        // Eliminado el checkbox useFFmpeg, siempre usamos PySceneDetect con fallback a FFmpeg

        await generateClipsFromFolder(folderPath, minDuration, maxDuration, threshold);
    });    // Handle browser tab switching to refresh content
    document.querySelectorAll('#browserTabs .nav-link').forEach(tab => {
        tab.addEventListener('shown.bs.tab', () => {
            loadVideoLists();
        });
    });

    // Clips per page selector
    document.getElementById('clipsPerPageSelect').addEventListener('change', (e) => {
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

    // ----- Socket.IO Event Handlers -----
    socket.on('connect', () => {
        console.log('Conectado al servidor WebSocket');
    });

    // Eventos de descarga
    socket.on('downloadStarted', (data) => {
        console.log('Descarga iniciada:', data);
        showDownloadStatus(`${data.message}`);

        downloadsInProgress = true;

        // Almacenar información de la descarga
        if (!currentDownloads.has(data.url)) {
            currentDownloads.set(data.url, {
                url: data.url,
                tag: data.tag,
                status: data.status,
                message: data.message
            });
        }

        updateDownloadList();
    });

    socket.on('downloadProgress', (data) => {
        console.log('Progreso de descarga:', data);

        // Actualizar información de la descarga
        if (currentDownloads.has(data.url)) {
            const download = currentDownloads.get(data.url);
            download.status = data.status;
            download.message = data.message;
            if (data.progress) {
                download.progress = data.progress;
            }
            currentDownloads.set(data.url, download);
        } else {
            currentDownloads.set(data.url, {
                url: data.url,
                tag: data.tag,
                status: data.status,
                message: data.message,
                progress: data.progress
            });
        }

        showDownloadStatus(`${data.message}`);
        if (data.progress) {
            updateDownloadProgress(data.progress);
        }

        updateDownloadList();
    });

    socket.on('downloadComplete', (data) => {
        console.log('Descarga completada:', data);

        // Remover de las descargas activas
        if (currentDownloads.has(data.url)) {
            currentDownloads.delete(data.url);
        }

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

        // Actualizar estado de la descarga
        if (data.url && currentDownloads.has(data.url)) {
            const download = currentDownloads.get(data.url);
            download.status = 'error';
            download.message = data.message;
            currentDownloads.set(data.url, download);
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
        showDownloadStatus(`${data.message}`);
    });

    socket.on('tagProcessingStarted', (data) => {
        console.log('Procesamiento de etiqueta iniciado:', data);
        showDownloadStatus(`${data.message}`);
    });

    socket.on('tagProcessingComplete', (data) => {
        console.log('Procesamiento de etiqueta completado:', data);
        showDownloadStatus(`${data.message}`);
    });

    // --- Rename Clips Tab Functionality ---

    function renderClipFolderList(foldersToShow) {
        if (!folderListContainer) return;
        folderListContainer.innerHTML = ''; // Clear previous list

        if (foldersToShow.length === 0) {
            folderListContainer.innerHTML = '<p class="text-muted">No folders match your filter or no folders found.</p>';
            return;
        }

        const listGroup = document.createElement('div');
        listGroup.className = 'list-group';
        foldersToShow.forEach(folder => {
            const listItem = document.createElement('label');
            listItem.className = 'list-group-item d-flex align-items-center';
            listItem.innerHTML = `
                <input class="form-check-input me-2" type="checkbox" value="${folder}" id="folder-${folder}">
                ${folder}
            `;
            listGroup.appendChild(listItem);
        });
        folderListContainer.appendChild(listGroup);
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
                folderFilterInput.addEventListener('input', (e) => {
                    const filterText = e.target.value.toLowerCase();
                    const filteredFolders = allClipFolders.filter(folder => folder.toLowerCase().includes(filterText));
                    renderClipFolderList(filteredFolders);
                });
            }

            if (selectAllFoldersBtn) {
                selectAllFoldersBtn.addEventListener('click', () => {
                    if (folderListContainer) {
                        folderListContainer.querySelectorAll('input[type="checkbox"]').forEach(checkbox => checkbox.checked = true);
                    }
                });
            }

            if (deselectAllFoldersBtn) {
                deselectAllFoldersBtn.addEventListener('click', () => {
                    if (folderListContainer) {
                        folderListContainer.querySelectorAll('input[type="checkbox"]').forEach(checkbox => checkbox.checked = false);
                    }
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
        const outputSubfolderName = document.getElementById('outputSubfolderName').value.trim();

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
                // Optionally, refresh folder list or clear selection
                // fetchAndDisplayClipFolders(); // Re-fetch to clear selection, or manually clear:
                selectedCheckboxes.forEach(cb => cb.checked = false);
            } else {
                renameFeedback.textContent = `Error: ${result.message || 'Unknown error'} Details: ${result.details || 'N/A'}`;
                renameFeedback.classList.remove('alert-info', 'alert-success');
                renameFeedback.classList.add('alert', 'alert-danger');
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
        beatSyncFolderListContainer.innerHTML = ''; // Clear previous list

        if (foldersToShow.length === 0) {
            beatSyncFolderListContainer.innerHTML = '<p class="text-muted">No folders match your filter or no clip folders found.</p>';
            return;
        }

        const listGroup = document.createElement('div');
        listGroup.className = 'list-group';
        foldersToShow.forEach(folder => {
            const listItem = document.createElement('label');
            listItem.className = 'list-group-item d-flex align-items-center';
            // Ensure unique IDs for checkboxes if this function is reused or if folder names can clash
            listItem.innerHTML = `
                <input class="form-check-input me-2" type="checkbox" value="${folder}" id="beatSyncFolderCheckbox-${folder.replace(/\s+/g, '-')}">
                ${folder}
            `;
            listGroup.appendChild(listItem);
        });
        beatSyncFolderListContainer.appendChild(listGroup);
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
        beatSyncFolderFilterInput.addEventListener('input', (e) => {
            const filterText = e.target.value.toLowerCase();
            const filteredFolders = allBeatSyncClipFolders.filter(folder => folder.toLowerCase().includes(filterText));
            renderBeatSyncClipFolderList(filteredFolders);
        });
    }

    if (beatSyncSelectAllFoldersBtn) {
        beatSyncSelectAllFoldersBtn.addEventListener('click', () => {
            if (beatSyncFolderListContainer) {
                beatSyncFolderListContainer.querySelectorAll('input[type="checkbox"]').forEach(checkbox => checkbox.checked = true);
            }
        });
    }

    if (beatSyncDeselectAllFoldersBtn) {
        beatSyncDeselectAllFoldersBtn.addEventListener('click', () => {
            if (beatSyncFolderListContainer) {
                beatSyncFolderListContainer.querySelectorAll('input[type="checkbox"]').forEach(checkbox => checkbox.checked = false);
            }
        });
    }

    if (audioFileUploadInput) {
        audioFileUploadInput.addEventListener('change', (event) => {
            const audioFile = event.target.files[0];
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
            if(formElements[i].id !== 'generateBeatSyncVideoBtn' && formElements[i].id !== 'audioFileUpload') {
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
        beatSyncResult.innerHTML = `
            <p class="mt-3">Video generated successfully:</p>
            <video src="/${resultData.videoPath}" controls class="img-fluid"></video>
            <p class="mt-2"><a href="/${resultData.videoPath}" download="${outputVideoName}" class="btn btn-success">
                <i class="bi bi-download"></i> Download Video
            </a></p>
        `;
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
        const currentSelection = folderSelect.value;
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

        // Restaurar la selección anterior si es posible
        if (currentSelection) {
            const exists = Array.from(folderSelect.options).some(opt => opt.value === currentSelection);
            if (exists) {
                folderSelect.value = currentSelection;
            }
        }
    } catch (error) {
        console.error('Error cargando lista de carpetas:', error);
    }
}

// Load video and clip lists from server
async function loadVideoLists() {
    try {
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
    errorDiv.innerHTML = `<i class="bi bi-exclamation-triangle"></i> ${message}`;

    // Insertar al principio
    resultsContainer.insertBefore(errorDiv, resultsContainer.firstChild);

    // Eliminar después de un tiempo
    setTimeout(() => errorDiv.remove(), 10000);
}

// Actualizar la barra de progreso
function updateDownloadProgress(percent) {
    const progressBar = document.getElementById('downloadProgress');
    progressBar.style.width = `${percent}%`;
    progressBar.setAttribute('aria-valuenow', percent);
}

// Añadir un resultado de descarga
function addDownloadResult(data) {
    const resultsContainer = document.getElementById('downloadResults');

    const item = document.createElement('div');
    item.className = 'list-group-item list-group-item-success d-flex justify-content-between align-items-center';

    const fileName = data.fileName || data.filePath.split('/').pop();
    item.innerHTML = `<span><i class="bi bi-check-circle me-2"></i>${fileName}</span>`;

    const playBtn = document.createElement('button');
    playBtn.className = 'btn btn-sm btn-primary';
    playBtn.innerHTML = '<i class="bi bi-play-fill"></i> Reproducir';
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
    const activeDownloads = Array.from(currentDownloads.values());

    if (activeDownloads.length === 0) {
        if (downloadsInProgress) {
            downloadStatus.textContent = 'Descargas finalizadas';
            downloadsInProgress = false;
        } else {
            downloadStatus.textContent = 'No hay descargas activas';
        }
        return;
    }

    // Mostrar el estado de la primera descarga activa
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
                playBtn.addEventListener('click', () => {
                    openVideoPlayer(`/downloads/${video.path}`, video.name);
                });

                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'btn btn-sm btn-danger ms-2';
                deleteBtn.innerHTML = '<i class="bi bi-trash"></i>';
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
                videoPreview.className = 'video-thumbnail d-flex justify-content-center align-items-center bg-dark text-white';
                videoPreview.innerHTML = '<i class="bi bi-play-circle fs-1"></i>';

                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'delete-video-btn';
                deleteBtn.innerHTML = '<i class="bi bi-trash"></i>';
                deleteBtn.title = 'Eliminar video';
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
        headerRow.innerHTML = `
            <div class="col-12 d-flex justify-content-between align-items-center">
                <h5 class="mb-0">${videoName} <span class="badge bg-secondary">${videoClips.length} clips</span></h5>
                <div class="pagination-info">
                    <small class="text-muted">Página ${currentPage} de ${totalPages}</small>
                </div>
            </div>
        `;
        videoSection.appendChild(headerRow);

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
    clipCol.id = `clip-container-${clip.path.replace(/[\/\.]/g, '-')}`;

    const clipCard = document.createElement('div');
    clipCard.className = 'card video-card';

    // Video preview (thumbnail)
    const videoContainer = document.createElement('div');
    videoContainer.className = 'video-container';

    // Create video element with lazy loading
    const videoElement = document.createElement('video');
    videoElement.className = 'w-100';
    videoElement.src = `/clips/${clip.path}`;
    videoElement.preload = 'none'; // Changed to 'none' for better performance
    videoElement.muted = true;
    videoElement.loop = true;    // Lazy loading: start loading and autoplay when video comes into view
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                videoElement.preload = 'metadata';
                // Autoplay when the video comes into view
                videoElement.addEventListener('loadeddata', () => {
                    videoElement.play().catch(error => {
                        console.log('Autoplay prevented:', error);
                    });
                }, { once: true });
                observer.unobserve(videoElement);
            }
        });
    });
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
    clipInfo.textContent = formatFileSize(clip.size);

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

// Generate clips from a video
async function generateClips(videoPath, minDuration, maxDuration, threshold, useFFmpeg) {
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
                minDuration,
                maxDuration,
                threshold,
                useFFmpeg
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

        // Display clip results
        if (data.clipPaths && data.clipPaths.length > 0) {
            data.clipPaths.forEach(clipPath => {
                const clipCol = document.createElement('div');
                clipCol.className = 'col-md-4 mb-3';
                const clipId = `clip-container-${clipPath.replace(/[\/\.]/g, '-')}`;
                clipCol.id = clipId;

                const clipCard = document.createElement('div');
                clipCard.className = 'card video-card';

                const clipName = clipPath.split('/').pop();
                const clipRelPath = clipPath.replace(/^output\/clips\//, '');

                const videoContainer = document.createElement('div');
                videoContainer.className = 'video-container';

                // Create video element with controls for direct playback
                const video = document.createElement('video');
                video.src = `/clips/${clipRelPath}`;
                video.controls = true;
                video.muted = true;
                video.preload = 'metadata';
                video.className = 'w-100';
                video.volume = 0.5; // Set default volume to 50%
                video.autoplay = true; // Auto-play the video
                video.loop = true;     // Loop the video playback

                // Add delete button
                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'delete-clip-btn';
                deleteBtn.innerHTML = '<i class="bi bi-trash"></i>';
                deleteBtn.title = 'Eliminar clip';
                deleteBtn.setAttribute('data-clip-path', clipRelPath);

                // Event for delete button - stop propagation
                deleteBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    deleteClip(clipRelPath, clipId);
                });

                videoContainer.appendChild(video);
                clipCard.appendChild(videoContainer);
                clipCard.appendChild(deleteBtn); // Add the delete button to the card

                const cardBody = document.createElement('div');
                cardBody.className = 'card-body';

                const cardTitle = document.createElement('h6');
                cardTitle.className = 'card-title text-truncate';
                cardTitle.textContent = clipName;

                cardBody.appendChild(cardTitle);
                clipCard.appendChild(cardBody);
                clipCol.appendChild(clipCard);
                resultsContainer.appendChild(clipCol);

                // Add click event to play/pause when clicking the card (not on controls)
                clipCard.addEventListener('click', (e) => {
                    // Only handle click if it's not on the delete button or video controls
                    if (e.target !== deleteBtn && !deleteBtn.contains(e.target) && !video.contains(e.target)) {
                        if (video.paused) {
                            video.play();
                        } else {
                            video.pause();
                        }
                    }
                });
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

// Generate clips from all videos in a folder
async function generateClipsFromFolder(folderPath, minDuration, maxDuration, threshold) {
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
                minDuration,
                maxDuration,
                threshold
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
                    const headerRow = document.createElement('div');
                    headerRow.className = 'row mb-2';
                    headerRow.innerHTML = `<div class="col-12"><h5>${videoName}</h5></div>`;
                    resultsContainer.appendChild(headerRow);

                    // Create a row for the clips
                    const clipsRow = document.createElement('div');
                    clipsRow.className = 'row mb-4';
                    clipsRow.id = `clips-group-gen-${videoName.replace(/[^a-zA-Z0-9]/g, '-')}`;

                    result.clipPaths.forEach((clipPath, index) => {
                        const clipCol = document.createElement('div');
                        clipCol.className = 'col-md-4 mb-3';
                        const clipId = `clip-container-gen-${clipPath.replace(/[\/\.]/g, '-')}`;
                        clipCol.id = clipId;

                        const clipCard = document.createElement('div');
                        clipCard.className = 'card video-card';

                        const clipName = clipPath.split('/').pop();
                        const clipRelPath = clipPath.replace(/^output\/clips\//, '');

                        const videoContainer = document.createElement('div');
                        videoContainer.className = 'video-container';

                        // Create video element with controls for direct playback
                        const video = document.createElement('video');
                        video.src = `/clips/${clipRelPath}`;
                        video.controls = true;
                        video.muted = true;
                        video.preload = 'metadata';
                        video.className = 'w-100';
                        video.volume = 0.5; // Set default volume to 50%
                        video.autoplay = true; // Auto-play the video
                        video.loop = true;     // Loop the video playback

                        // Add delete button
                        const deleteBtn = document.createElement('button');
                        deleteBtn.className = 'delete-clip-btn';
                        deleteBtn.innerHTML = '<i class="bi bi-trash"></i>';
                        deleteBtn.title = 'Eliminar clip';
                        deleteBtn.setAttribute('data-clip-path', clipRelPath);

                        // Event for delete button - stop propagation
                        deleteBtn.addEventListener('click', (e) => {
                            e.stopPropagation();
                            deleteClip(clipRelPath, clipId);
                        });

                        videoContainer.appendChild(video);
                        clipCard.appendChild(videoContainer);
                        clipCard.appendChild(deleteBtn); // Add the delete button

                        const cardBody = document.createElement('div');
                        cardBody.className = 'card-body';

                        const cardTitle = document.createElement('h6');
                        cardTitle.className = 'card-title text-truncate';
                        cardTitle.textContent = clipName;

                        cardBody.appendChild(cardTitle);
                        clipCard.appendChild(cardBody);
                        clipCol.appendChild(clipCard);
                        clipsRow.appendChild(clipCol);

                        // Add click event to play/pause when clicking the card (not on controls)
                        clipCard.addEventListener('click', (e) => {
                            // Only handle click if it's not on the delete button or video controls
                            if (e.target !== deleteBtn && !deleteBtn.contains(e.target) && !video.contains(e.target)) {
                                if (video.paused) {
                                    video.play();
                                } else {
                                    video.pause();
                                }
                            }
                        });
                    });

                    resultsContainer.appendChild(clipsRow);
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