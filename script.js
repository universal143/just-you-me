import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js';
import { getDatabase, ref, onValue, set } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js';
import { firebaseConfig } from './firebase-config.js';

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

let currentRoomId = null;
let ytPlayer = null;       // YouTube player
let videoPlayer = null;    // <video> or Drive iframe
let isPlaying = false;
let currentTime = 0;
let videoId = null;
let ytReady = false;
let isHost = false;
let playbackRate = 1;      // speed

const elements = {
  roomId: document.getElementById('roomId'),
  createRoom: document.getElementById('createRoom'),
  joinRoom: document.getElementById('joinRoom'),
  roomControls: document.getElementById('roomControls'),
  videoPlayer: document.getElementById('videoPlayer'),
  videoUrl: document.getElementById('videoUrl'),
  loadVideo: document.getElementById('loadVideo'),
  playPauseBtn: document.getElementById('playPauseBtn'),
  prevBtn: document.getElementById('prevBtn'),
  nextBtn: document.getElementById('nextBtn'),
  currentTime: document.getElementById('currentTime'),
  duration: document.getElementById('duration'),
  roomStatus: document.getElementById('roomStatus'),
  viewerCount: document.getElementById('viewerCount'),
  errorMsg: document.getElementById('errorMsg'),
  statusText: document.getElementById('statusText'),
  syncStatus: document.getElementById('syncStatus'),
  playbackRate: document.getElementById('playbackRate')
};

function showError(msg) {
  elements.errorMsg.textContent = msg;
  elements.errorMsg.classList.remove('hidden');
  setTimeout(() => elements.errorMsg.classList.add('hidden'), 5000);
}

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60) || 0;
  const secs = Math.floor(seconds % 60) || 0;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/* ---------- URL parsing (YouTube / Drive / Dropbox / direct) ---------- */
function parseVideoUrl(url) {
  const ytRegex = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/;
  const ytMatch = url.match(ytRegex);
  if (ytMatch) return { type: 'youtube', id: ytMatch[1] };

  const driveRegex = /\/file\/d\/([a-zA-Z0-9-_]+)/;
  const driveMatch = url.match(driveRegex);
  if (driveMatch) {
    const fileId = driveMatch[1];
    return { type: 'drive', id: fileId };
  }

  if (url.includes('dropbox.com')) {
    try {
      const u = new URL(url);
      u.hostname = 'dl.dropboxusercontent.com';
      u.searchParams.delete('dl');
      return { type: 'direct', id: u.toString() };
    } catch (e) {}
  }

  if (url.includes('video-downloads.googleusercontent.com')) {
    return { type: 'direct', id: url };
  }

  const directRegex = /\.(mp4|webm|ogg)(\?|#|$)/i;
  if (directRegex.test(url)) {
    return { type: 'direct', id: url };
  }

  return null;
}

/* ---------- Speed helper ---------- */
function applyPlaybackRate() {
  if (ytPlayer && ytReady) {
    try {
      ytPlayer.setPlaybackRate(playbackRate);
    } catch {}
  } else if (videoPlayer && videoPlayer.tagName === 'VIDEO') {
    videoPlayer.playbackRate = playbackRate;
  }
}

/* ---------- YouTube API ---------- */
function loadYouTubeApiIfNeeded() {
  if (window.YT && window.YT.Player) return;
  const tag = document.createElement('script');
  tag.src = 'https://www.youtube.com/iframe_api';
  const firstScriptTag = document.getElementsByTagName('script')[0];
  firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
}

window.onYouTubeIframeAPIReady = function () {};

function createYouTubePlayer(videoId, startTime = 0) {
  loadYouTubeApiIfNeeded();
  elements.videoPlayer.innerHTML = '<div id="yt-player"></div>';
  ytReady = false;

  ytPlayer = new YT.Player('yt-player', {
    videoId,
    playerVars: {
      controls: 1,
      modestbranding: 1
    },
    events: {
      onReady: (event) => {
        ytReady = true;
        const dur = event.target.getDuration();
        if (!isNaN(dur) && dur > 0) {
          elements.duration.textContent = formatTime(dur);
        }
        if (startTime > 0) {
          event.target.seekTo(startTime, true);
        }
        event.target.setPlaybackRate(playbackRate);

        setInterval(() => {
          if (ytReady && ytPlayer && typeof ytPlayer.getCurrentTime === 'function') {
            currentTime = ytPlayer.getCurrentTime() || 0;
            elements.currentTime.textContent = formatTime(currentTime);
          }
        }, 500);

        if (isPlaying) {
          event.target.playVideo();
        } else {
          event.target.pauseVideo();
        }
      }
    }
  });
  videoPlayer = null;
}

/* ---------- Player creation ---------- */
function createVideoPlayer(type, id, startAt = 0) {
  elements.videoPlayer.innerHTML = '';
  ytPlayer = null;
  ytReady = false;
  videoPlayer = null;

  if (type === 'youtube') {
    createYouTubePlayer(id, startAt);
    elements.statusText.textContent = 'Loaded YouTube video';
  } else if (type === 'drive') {
    const iframe = document.createElement('iframe');
    iframe.src = `https://drive.google.com/file/d/${id}/preview`;
    iframe.allow = 'autoplay';
    iframe.allowFullscreen = true;
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.border = '0';
    elements.videoPlayer.appendChild(iframe);
    videoPlayer = iframe;
    elements.statusText.textContent = 'Loaded Google Drive video (preview)';
  } else if (type === 'direct') {
    const video = document.createElement('video');
    video.src = id;
    video.controls = true;
    video.autoplay = false;
    video.playsInline = true;
    video.style.width = '100%';
    video.style.height = '100%';
    elements.videoPlayer.appendChild(video);
    videoPlayer = video;
    videoPlayer.playbackRate = playbackRate;

    videoPlayer.addEventListener('loadedmetadata', () => {
      const dur = videoPlayer.duration;
      if (!isNaN(dur)) {
        elements.duration.textContent = formatTime(dur);
      }
    });

    videoPlayer.addEventListener('timeupdate', () => {
      currentTime = videoPlayer.currentTime || 0;
      elements.currentTime.textContent = formatTime(currentTime);
    });
  }

  videoId = { type, id };
}

/* ---------- Firebase state ---------- */
function updateRoomState(partialState) {
  if (!currentRoomId) return;
  const roomRef = ref(db, `rooms/${currentRoomId}`);
  set(roomRef, {
    videoId,
    isPlaying,
    currentTime,
    playbackRate,
    timestamp: Date.now(),
    ...partialState
  });
  if (elements.syncStatus) {
    elements.syncStatus.textContent = 'Synced just now';
  }
}

/* ---------- Apply local state ---------- */
function applyPlayPauseState() {
  if (isPlaying) {
    elements.playPauseBtn.textContent = '⏸ Pause';
    if (ytPlayer && ytReady) {
      ytPlayer.playVideo();
    } else if (videoPlayer && videoPlayer.tagName === 'VIDEO') {
      videoPlayer.play();
    }
  } else {
    elements.playPauseBtn.textContent = '▶️ Play';
    if (ytPlayer && ytReady) {
      ytPlayer.pauseVideo();
    } else if (videoPlayer && videoPlayer.tagName === 'VIDEO') {
      videoPlayer.pause();
    }
  }
}

function applySeekState() {
  elements.currentTime.textContent = formatTime(currentTime);

  if (ytPlayer && ytReady) {
    const now = ytPlayer.getCurrentTime() || 0;
    const diff = Math.abs(now - currentTime);
    if (diff > 1.0) {
      ytPlayer.seekTo(currentTime, true);
    }
  } else if (videoPlayer && videoPlayer.tagName === 'VIDEO') {
    const now = videoPlayer.currentTime || 0;
    const diff = Math.abs(now - currentTime);
    if (diff > 2) { // thoda zyada tolerance
      videoPlayer.currentTime = currentTime;
    }
  }
}

/* ---------- Sync from Firebase ---------- */
function syncVideo() {
  if (!currentRoomId) return;

  const roomRef = ref(db, `rooms/${currentRoomId}`);
  onValue(roomRef, (snapshot) => {
    const data = snapshot.val();
    if (!data) return;

    if (typeof data.playbackRate === 'number') {
      playbackRate = data.playbackRate;
      if (elements.playbackRate) {
        elements.playbackRate.value = String(playbackRate);
      }
      applyPlaybackRate();
    }

    if (data.videoId && (data.videoId.type !== videoId?.type || data.videoId.id !== videoId?.id)) {
      createVideoPlayer(data.videoId.type, data.videoId.id, data.currentTime || 0);
    }

    if (typeof data.isPlaying === 'boolean') {
      isPlaying = data.isPlaying;
      applyPlayPauseState();
    }

    if (typeof data.currentTime === 'number') {
      currentTime = data.currentTime;
      applySeekState();
    }

    if (typeof data.duration === 'number') {
      elements.duration.textContent = formatTime(data.duration);
    }
  });
}

/* ---------- Host time sync (slower) ---------- */
function startHostTimeSync() {
  setInterval(() => {
    if (!currentRoomId) return;
    if (!isHost) return;

    let t = 0;
    if (ytPlayer && ytReady) {
      t = ytPlayer.getCurrentTime() || 0;
    } else if (videoPlayer && videoPlayer.tagName === 'VIDEO') {
      t = videoPlayer.currentTime || 0;
    } else {
      return;
    }

    currentTime = t;
    elements.currentTime.textContent = formatTime(currentTime);
    updateRoomState({ currentTime });
  }, 3000); // 3s
}

/* ---------- UI events ---------- */
elements.createRoom.addEventListener('click', () => {
  const roomId = elements.roomId.value.trim() || 'room_' + Math.random().toString(36).substr(2, 8);
  currentRoomId = roomId;
  isHost = true;
  elements.roomId.value = roomId;
  elements.roomStatus.textContent = `Room: ${roomId}`;
  elements.roomControls.classList.remove('hidden');
  elements.statusText.textContent = 'Room created. Load a video to start.';
  syncVideo();
  startHostTimeSync();
});

elements.joinRoom.addEventListener('click', () => {
  const roomId = elements.roomId.value.trim();
  if (!roomId) {
    showError('Enter a room ID first');
    return;
  }
  currentRoomId = roomId;
  isHost = false;
  elements.roomStatus.textContent = `Room: ${roomId}`;
  elements.roomControls.classList.remove('hidden');
  elements.statusText.textContent = 'Joined room. Waiting for host to load a video.';
  syncVideo();
  startHostTimeSync();
});

elements.loadVideo.addEventListener('click', () => {
  const url = elements.videoUrl.value.trim();
  if (!url) {
    showError('Enter a video URL');
    return;
  }

  const parsed = parseVideoUrl(url);
  if (!parsed) {
    showError('Unsupported URL. Use YouTube, Google Drive, Dropbox, or direct MP4/WebM');
    return;
  }

  createVideoPlayer(parsed.type, parsed.id, 0);
  isPlaying = false;
  currentTime = 0;
  elements.currentTime.textContent = '0:00';
  elements.duration.textContent = '0:00';
  elements.statusText.textContent = 'Video loaded. Press Play to start.';
  updateRoomState({ videoId: parsed, currentTime, isPlaying });
});

elements.playPauseBtn.addEventListener('click', () => {
  isPlaying = !isPlaying;
  updateRoomState({ isPlaying });
});

elements.prevBtn.addEventListener('click', () => {
  currentTime = Math.max(0, currentTime - 10);
  updateRoomState({ currentTime });
});

elements.nextBtn.addEventListener('click', () => {
  currentTime += 10;
  updateRoomState({ currentTime });
});

if (elements.playbackRate) {
  elements.playbackRate.addEventListener('change', () => {
    const val = parseFloat(elements.playbackRate.value);
    if (!isNaN(val) && val > 0) {
      playbackRate = val;
      applyPlaybackRate();
      if (currentRoomId && isHost) {
        updateRoomState({ playbackRate });
      }
    }
  });
}

const urlParams = new URLSearchParams(window.location.search);
if (urlParams.has('room')) {
  elements.roomId.value = urlParams.get('room');
  elements.joinRoom.click();
}
