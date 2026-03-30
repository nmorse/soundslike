let currentAudio = null;
let loopEnabled = false;

let loopStart = 0;
let loopEnd = 1; // normalized (0–1)

let duration = 1;



import {
  saveRecording,
  listRecordings,
  loadRecording,
  deleteRecording
} from "./fs.js";

let mediaRecorder;
let chunks = [];

const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const list = document.getElementById("recordings");


const canvas = document.getElementById("timeline");
const ctx = canvas.getContext("2d");

let dragging = null; // "start" | "end"

canvas.addEventListener("mousedown", (e) => {
  const x = e.offsetX / canvas.width;

  if (Math.abs(x - loopStart) < 0.05) dragging = "start";
  else if (Math.abs(x - loopEnd) < 0.05) dragging = "end";
});

canvas.addEventListener("mousemove", (e) => {
  if (!dragging) return;

  let x = e.offsetX / canvas.width;
  x = Math.max(0, Math.min(1, x));

  if (dragging === "start") {
    loopStart = Math.min(x, loopEnd - 0.01);
  } else {
    loopEnd = Math.max(x, loopStart + 0.01);
  }
});

canvas.addEventListener("mouseup", () => dragging = null);
canvas.addEventListener("mouseleave", () => dragging = null);

document.getElementById("toggleLoop").onclick = () => {
  loopEnabled = !loopEnabled;
  document.getElementById("toggleLoop").textContent =
    `Loop: ${loopEnabled ? "ON" : "OFF"}`;
};

function updateLoop() {
  if (currentAudio && loopEnabled) {
    const t = currentAudio.currentTime;
    const startTime = loopStart * duration;
    const endTime = loopEnd * duration;

    if (t >= endTime) {
      currentAudio.currentTime = startTime;
    }
  }

  requestAnimationFrame(updateLoop);
}

updateLoop();

function drawTimeline() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Background
  ctx.fillStyle = "#ddd";
  ctx.fillRect(0, 30, canvas.width, 20);

  // Loop region
  ctx.fillStyle = "#88c";
  ctx.fillRect(
    loopStart * canvas.width,
    30,
    (loopEnd - loopStart) * canvas.width,
    20
  );

  // Handles
  ctx.fillStyle = "#000";

  ctx.fillRect(loopStart * canvas.width - 2, 20, 4, 40);
  ctx.fillRect(loopEnd * canvas.width - 2, 20, 4, 40);

  // Playhead
  if (currentAudio) {
    const x = (currentAudio.currentTime / duration) * canvas.width;

    ctx.fillStyle = "red";
    ctx.fillRect(x - 1, 10, 2, 60);
  }

  requestAnimationFrame(drawTimeline);
}

drawTimeline();




startBtn.onclick = async () => {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

  mediaRecorder = new MediaRecorder(stream);
  chunks = [];

  mediaRecorder.ondataavailable = e => chunks.push(e.data);

  mediaRecorder.onstop = async () => {
    const blob = new Blob(chunks, { type: "audio/webm" });

    const filename = await saveRecording(blob);

    addRecordingToUI(filename);
  };

  mediaRecorder.start();

  startBtn.disabled = true;
  stopBtn.disabled = false;
};

stopBtn.onclick = () => {
  mediaRecorder.stop();

  startBtn.disabled = false;
  stopBtn.disabled = true;
};

async function addRecordingToUI(filename) {
  const file = await loadRecording(filename);
  const url = URL.createObjectURL(file);

  const li = document.createElement("li");

  const audio = document.createElement("audio");
  audio.controls = true;
  audio.src = url;

  audio.onplay = () => {
    currentAudio = audio;

    duration = audio.duration || 1;
    // loopStart = 0;
    // loopEnd = 1;
  };

  li.appendChild(document.createTextNode(filename));
  li.appendChild(document.createElement("br"));
  li.appendChild(audio);

  const del = document.createElement("button");
  del.textContent = "Delete";
  del.onclick = () => deleteRec(filename);

  li.appendChild(document.createElement("br"));
  li.appendChild(del);

  list.appendChild(li);
}

window.deleteRec = async (filename) => {
  await deleteRecording(filename);
  location.reload();
};

// Load all recordings on startup
window.onload = async () => {
  const files = await listRecordings();

  for (const f of files) {
    await addRecordingToUI(f);
  }
};

// Register service worker
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js");
}

async function fileToAudioBuffer(file) {
  const arrayBuffer = await file.arrayBuffer();
  const audioCtx = new AudioContext();
  return await audioCtx.decodeAudioData(arrayBuffer);
}

function encodeWAV(audioBuffer) {
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const length = audioBuffer.length * numChannels * 2;

  const buffer = new ArrayBuffer(44 + length);
  const view = new DataView(buffer);

  function writeString(offset, str) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  // RIFF header
  writeString(0, "RIFF");
  view.setUint32(4, 36 + length, true);
  writeString(8, "WAVE");

  // fmt chunk
  writeString(12, "fmt ");
  view.setUint32(16, 16, true); // PCM
  view.setUint16(20, 1, true); // format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * 2, true);
  view.setUint16(32, numChannels * 2, true);
  view.setUint16(34, 16, true);

  // data chunk
  writeString(36, "data");
  view.setUint32(40, length, true);

  // interleave
  let offset = 44;

  for (let i = 0; i < audioBuffer.length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      let sample = audioBuffer.getChannelData(ch)[i];
      sample = Math.max(-1, Math.min(1, sample));
      view.setInt16(offset, sample * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([buffer], { type: "audio/wav" });
}

function trimBuffer(audioBuffer, startNorm, endNorm) {
  const startSample = Math.floor(startNorm * audioBuffer.length);
  const endSample = Math.floor(endNorm * audioBuffer.length);

  const frameCount = endSample - startSample;
  const newBuffer = new AudioContext().createBuffer(
    audioBuffer.numberOfChannels,
    frameCount,
    audioBuffer.sampleRate
  );

  for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
    const oldData = audioBuffer.getChannelData(ch);
    const newData = newBuffer.getChannelData(ch);

    for (let i = 0; i < frameCount; i++) {
      newData[i] = oldData[startSample + i];
    }
  }

  return newBuffer;
}

async function saveWavFile(blob) {
  const dir = await navigator.storage.getDirectory();
  const recDir = await dir.getDirectoryHandle("recordings", { create: true });

  const filename = `trim-${Date.now()}.wav`;

  const handle = await recDir.getFileHandle(filename, { create: true });
  const writable = await handle.createWritable();

  await writable.write(blob);
  await writable.close();

  return filename;
}


document.getElementById("exportTrim").onclick = async () => {
  if (!currentAudio) {
    alert("Play a recording first");
    return;
  }

  // Find current file
  const src = currentAudio.src;
  const response = await fetch(src);
  const blob = await response.blob();

  // Decode
  const audioBuffer = await fileToAudioBuffer(blob);

  // Trim
  const trimmed = trimBuffer(audioBuffer, loopStart, loopEnd);

  // Encode
  const wavBlob = encodeWAV(trimmed);

  // Save
  const filename = await saveWavFile(wavBlob);

  // Add to UI
  addRecordingToUI(filename);
};