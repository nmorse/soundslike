const DIR_NAME = "recordings";

async function getDir() {
  const root = await navigator.storage.getDirectory();
  return await root.getDirectoryHandle(DIR_NAME, { create: true });
}

export async function saveRecording(blob) {
  const dir = await getDir();

  const filename = `rec-${Date.now()}.webm`;

  const fileHandle = await dir.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();

  await writable.write(blob);
  await writable.close();

  return filename;
}

export async function listRecordings() {
  const dir = await getDir();

  const files = [];

  for await (const [name, handle] of dir.entries()) {
    files.push(name);
  }

  return files.sort();
}

export async function loadRecording(name) {
  const dir = await getDir();
  const handle = await dir.getFileHandle(name);
  const file = await handle.getFile();

  return file;
}

export async function deleteRecording(name) {
  const dir = await getDir();
  await dir.removeEntry(name);
}