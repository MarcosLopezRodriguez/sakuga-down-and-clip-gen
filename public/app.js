document.addEventListener('DOMContentLoaded', () => {
    // Conexión de Socket.IO
    const socket = io();

    // Variables globales
    let currentDownloads = new Map();
    let allDownloadedVideos = [];

    // Tab navigation
    const navLinks = document.querySelectorAll('.navbar-nav .nav-link');
    const sections = document.querySelectorAll('.section-content');

    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const targetSection = link.dataset.section;

            // Hide all sections and remove active class from nav links
            sections.forEach(section => section.classList.remove('active'));
            navLinks.forEach(navLink => navLink.classList.remove('active'));

            // Show target section and set active class on clicked link
            document.getElementById(targetSection).classList.add('active');
            link.classList.add('active');
        });
    });

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
    });

    // Handle browser tab switching to refresh content
    document.querySelectorAll('#browserTabs .nav-link').forEach(tab => {
        tab.addEventListener('shown.bs.tab', () => {
            loadVideoLists();
        });
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

    // Initialize IntersectionObserver for videos
    const videoObserver = new IntersectionObserver(handleVideoIntersection, {
        rootMargin: '100px 0px', // Load when 100px away from viewport
        threshold: 0.01         // Even a small part visible
    });
});

// Constants for lazy loading
const INITIAL_CLIPS_PER_GROUP = 6; // Number of clips to show initially
const CLIPS_TO_LOAD_PER_CLICK = 6; // Number of clips to load on "Load More"

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
        downloadStatus.textContent = 'No hay descargas activas';
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

                videoItem.appendChild(playBtn);
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
                videoCard.appendChild(videoCardBody);
                videoCol.appendChild(videoCard);
                container.appendChild(videoCol);
            });
        }
    });
}

// Display generated clips in the browser section
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
        // Add header for this video's clips
        const headerRow = document.createElement('div');
        headerRow.className = 'row mb-2 mt-4';
        headerRow.innerHTML = `<div class="col-12"><h5>${videoName}</h5></div>`;
        container.appendChild(headerRow);

        // Create a row for this video's clips
        const clipsRow = document.createElement('div');
        clipsRow.className = 'row mb-3';
        clipsRow.id = `clips-group-${videoName.replace(/[^a-zA-Z0-9]/g, '-')}`;
        container.appendChild(clipsRow); // Append row first

        // Store all clips for this group to handle "Load More"
        clipsRow.dataset.allClips = JSON.stringify(videoClips);
        clipsRow.dataset.loadedCount = '0';
        clipsRow.dataset.videoName = videoName; // For context in event handlers

        loadMoreClipsForGroup(clipsRow); // Load initial batch

        // Add "Load More" button if necessary
        if (videoClips.length > INITIAL_CLIPS_PER_GROUP) {
            const loadMoreButtonRow = document.createElement('div');
            loadMoreButtonRow.className = 'row mb-4 text-center';
            const loadMoreButton = document.createElement('button');
            loadMoreButton.className = 'btn btn-outline-primary btn-sm load-more-clips';
            loadMoreButton.textContent = 'Cargar más clips';
            loadMoreButton.dataset.videoName = videoName; // Link button to its group
            loadMoreButtonRow.appendChild(loadMoreButton);
            container.appendChild(loadMoreButtonRow); // Append after the clipsRow
        }
    });

    // Event delegation for "Load More" buttons
    container.addEventListener('click', function(event) {
        if (event.target.classList.contains('load-more-clips')) {
            const videoName = event.target.dataset.videoName;
            const groupRow = document.getElementById(`clips-group-${videoName.replace(/[^a-zA-Z0-9]/g, '-')}`);
            if (groupRow) {
                loadMoreClipsForGroup(groupRow);
                // Hide button if all loaded (loadMoreClipsForGroup will handle this)
                const allClipsForGroup = JSON.parse(groupRow.dataset.allClips || '[]');
                const loadedCount = parseInt(groupRow.dataset.loadedCount || '0');
                if (loadedCount >= allClipsForGroup.length) {
                    event.target.style.display = 'none';
                }
            }
        }
    });
}


function loadMoreClipsForGroup(groupRow) {
    const allClips = JSON.parse(groupRow.dataset.allClips || '[]');
    let loadedCount = parseInt(groupRow.dataset.loadedCount || '0');
    const videoName = groupRow.dataset.videoName;
    const clipsToLoad = CLIPS_TO_LOAD_PER_CLICK;

    const clipsToRender = allClips.slice(loadedCount, loadedCount + clipsToLoad);

    clipsToRender.forEach(clip => {
        const clipCol = createClipPlaceholderElement(clip, videoName); // This returns the col
        const clipCard = clipCol.querySelector('.card.video-card'); // Get the card to observe
        groupRow.appendChild(clipCol);
        if (clipCard) { // Ensure clipCard exists before observing
            videoObserver.observe(clipCard);
        }
    });

    loadedCount += clipsToRender.length;
    groupRow.dataset.loadedCount = loadedCount.toString();

    // Check if "Load More" button for this group should be hidden
    if (loadedCount >= allClips.length) {
        const loadMoreButton = document.querySelector(`.load-more-clips[data-video-name="${videoName}"]`);
        if (loadMoreButton) {
            loadMoreButton.style.display = 'none';
        }
    }
}


function createClipPlaceholderElement(clip, videoName) {
    const clipCol = document.createElement('div');
    clipCol.className = 'col-md-3 mb-4'; // Bootstrap column
    clipCol.id = `clip-container-${clip.path.replace(/[\/\.]/g, '-')}`;

    const clipCard = document.createElement('div');
    clipCard.className = 'card video-card clip-placeholder'; // Add clip-placeholder class

    // Placeholder content
    const placeholderContent = document.createElement('div');
    placeholderContent.className = 'clip-placeholder-content'; // Target for IntersectionObserver
    placeholderContent.style.height = '150px'; // Approximate height of a video player
    placeholderContent.style.display = 'flex';
    placeholderContent.style.alignItems = 'center';
    placeholderContent.style.justifyContent = 'center';
    placeholderContent.style.border = '1px dashed #ccc';
    placeholderContent.innerHTML = `<i class="bi bi-film fs-1 text-muted"></i>`;

    // Store data needed to create the video element later
    placeholderContent.dataset.src = `/clips/${clip.path}`;
    placeholderContent.dataset.clipName = clip.name;
    placeholderContent.dataset.clipPath = clip.path; // For delete functionality
    placeholderContent.dataset.videoName = videoName; // For context
    placeholderContent.dataset.clipSize = clip.size;

    // Delete button (part of the placeholder card structure)
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-clip-btn';
    deleteBtn.innerHTML = '<i class="bi bi-trash"></i>';
    deleteBtn.title = 'Eliminar clip';
    deleteBtn.setAttribute('data-clip-path', clip.path); // Used by deleteClip
    
    deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent card click event
        deleteClip(clip.path, clipCol.id);
    });

    clipCard.appendChild(placeholderContent);
    clipCard.appendChild(deleteBtn); // Delete button is visible on placeholder

    // Card body for name (visible on placeholder)
    const clipCardBody = document.createElement('div');
    clipCardBody.className = 'card-body';
    const clipTitle = document.createElement('h6');
    clipTitle.className = 'card-title text-truncate';
    clipTitle.textContent = clip.name;
    clipCardBody.appendChild(clipTitle);
    clipCard.appendChild(clipCardBody);
    
    clipCol.appendChild(clipCard);
    return clipCol;
}

function handleVideoIntersection(entries, observer) {
    entries.forEach(entry => {
        const clipCard = entry.target; // This is now the .card.video-card element

        if (entry.isIntersecting) {
            // Video is coming into view or is in view
            if (clipCard.dataset.loaded !== 'true') {
                // Not loaded yet, so load it
                const placeholderContent = clipCard.querySelector('.clip-placeholder-content');
                if (!placeholderContent) return; // Should not happen if not loaded

                const videoSrc = placeholderContent.dataset.src;
                // const clipName = placeholderContent.dataset.clipName; // Available if needed
                // const videoName = placeholderContent.dataset.videoName; // Available if needed
                // const clipSize = placeholderContent.dataset.clipSize; // Available if needed

                const videoContainer = document.createElement('div');
                videoContainer.className = 'video-container';
                
                const videoElement = document.createElement('video');
                videoElement.className = 'w-100';
                videoElement.src = videoSrc;
                videoElement.preload = 'metadata';
                videoElement.muted = true;
                videoElement.controls = true;
                videoElement.autoplay = true; // Autoplay when loaded due to intersection
                videoElement.loop = true;
                videoElement.volume = 0.5;

                videoContainer.appendChild(videoElement);

                // Replace placeholder content with video container
                // The delete button and card body are already part of clipCard, outside placeholderContent
                clipCard.replaceChild(videoContainer, placeholderContent);
                clipCard.dataset.loaded = 'true';
                clipCard.classList.remove('clip-placeholder'); // Visual class indicating placeholder state

                // Add click to play/pause on card (if not on controls or delete button)
                clipCard.addEventListener('click', (e) => {
                    const deleteBtn = clipCard.querySelector('.delete-clip-btn');
                    // Check if the click target is the video element itself or its controls
                    if (e.target === videoElement || videoElement.contains(e.target)) {
                        return; // Let video controls handle it
                    }
                    if (deleteBtn && (e.target === deleteBtn || deleteBtn.contains(e.target))) {
                        return; // Let delete button handle it
                    }

                    // If click is on the card but not on controls or delete button
                    if (videoElement.paused) {
                        videoElement.play().catch(err => console.error("Play error:", err));
                    } else {
                        videoElement.pause();
                    }
                });
            } else {
                // Video was already loaded, potentially play if it was paused by scrolling out
                // However, autoplay on intersection handles the initial play.
                // Re-playing automatically if user manually paused might be bad UX.
                // For now, we'll rely on autoplay on load and manual controls.
            }
        } else {
            // Video is scrolling out of view
            if (clipCard.dataset.loaded === 'true') {
                const videoElement = clipCard.querySelector('video');
                if (videoElement && !videoElement.paused) {
                    videoElement.pause();
                    console.log(`Paused video: ${videoElement.src}`);
                }
            }
        }
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

        // Remove clip from DOM if successful
        const clipElement = document.getElementById(elementId);
        if (clipElement) {
            // Animate removal
            clipElement.style.transition = 'all 0.3s';
            clipElement.style.opacity = '0';
            clipElement.style.transform = 'scale(0.8)';

            setTimeout(() => {
                clipElement.remove();

                // Check if parent row is now empty
                const parentRow = document.querySelector(`#clips-group-${clipPath.split('/')[0].replace(/[^a-zA-Z0-9]/g, '-')}`);
                if (parentRow && parentRow.querySelectorAll('.col-md-3').length === 0) {
                    // Remove video header too
                    const header = parentRow.previousElementSibling;
                    if (header && header.classList.contains('mb-2')) {
                        header.remove();
                    }
                    parentRow.remove();
                }

                // If no more clips, show "no clips" message
                if (document.querySelectorAll('#generatedClips .col-md-3').length === 0) {
                    document.getElementById('noClipsMessage').style.display = 'block';
                }

            }, 300);
        }

        console.log(`Clip eliminado: ${clipPath}`);

    } catch (error) {
        console.error('Error al eliminar clip:', error);
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