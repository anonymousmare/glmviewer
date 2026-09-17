const $ = (selector) => document.querySelector(selector);
const state = { file: null, entries: [], path: "" };
const decoder = new TextDecoder("utf-8");

function u16(view, offset) { return view.getUint16(offset, true); }
function u32(view, offset) { return view.getUint32(offset, true); }
function cleanPath(value) {
  return value.replaceAll("\\", "/").replace(/^\/+/, "").split("/").filter((part) => part && part !== "." && part !== "..").join("/");
}
function formatSize(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 3);
  return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}
async function readSlice(file, start, length) { return new Uint8Array(await file.slice(start, start + length).arrayBuffer()); }

async function parseZip(file) {
  const tailSize = Math.min(file.size, 65557);
  const tail = await readSlice(file, file.size - tailSize, tailSize);
  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let end = -1;
  for (let i = tail.length - 22; i >= 0; i--) if (u32(view, i) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new Error("This GLM is not a ZIP-compatible archive. Its format may need a dedicated parser.");
  const entryCount = u16(view, end + 10);
  const directorySize = u32(view, end + 12);
  const directoryOffset = u32(view, end + 16);
  if (entryCount === 0xffff || directoryOffset === 0xffffffff) throw new Error("ZIP64 archives are not supported yet.");
  const directory = await readSlice(file, directoryOffset, directorySize);
  const dirView = new DataView(directory.buffer, directory.byteOffset, directory.byteLength);
  const entries = [];
  let cursor = 0;
  while (cursor + 46 <= directory.length && entries.length < entryCount) {
    if (u32(dirView, cursor) !== 0x02014b50) throw new Error("The archive directory is damaged or unreadable.");
    const flags = u16(dirView, cursor + 8), method = u16(dirView, cursor + 10);
    const compressedSize = u32(dirView, cursor + 20), size = u32(dirView, cursor + 24);
    const nameLength = u16(dirView, cursor + 28), extraLength = u16(dirView, cursor + 30), commentLength = u16(dirView, cursor + 32);
    const rawName = directory.subarray(cursor + 46, cursor + 46 + nameLength);
    const name = cleanPath(decoder.decode(rawName));
    if (name) entries.push({ name, isDirectory: decoder.decode(rawName).endsWith("/"), size, compressedSize, method, flags, offset: u32(dirView, cursor + 42) });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function extract(entry) {
  if (entry.flags & 1) throw new Error("Password-protected entries cannot be extracted.");
  const header = await readSlice(state.file, entry.offset, 30);
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  if (u32(view, 0) !== 0x04034b50) throw new Error("The file header is damaged.");
  const dataOffset = entry.offset + 30 + u16(view, 26) + u16(view, 28);
  const compressed = state.file.slice(dataOffset, dataOffset + entry.compressedSize);
  if (entry.method === 0) return compressed;
  if (entry.method === 8 && typeof DecompressionStream !== "undefined") {
    return new Response(compressed.stream().pipeThrough(new DecompressionStream("deflate-raw"))).blob();
  }
  throw new Error(`Compression method ${entry.method} is not supported by this browser.`);
}

async function downloadEntry(entry) {
  try {
    const blob = await extract(entry);
    const url = URL.createObjectURL(blob), anchor = document.createElement("a");
    anchor.href = url; anchor.download = entry.name.split("/").pop(); anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    toast(`Extracted ${anchor.download}`);
  } catch (error) { showNotice(error.message); }
}

function currentItems() {
  const query = $("#searchInput").value.trim().toLowerCase();
  if (query) return state.entries.filter((entry) => !entry.isDirectory && entry.name.toLowerCase().includes(query)).map((entry) => ({ ...entry, label: entry.name }));
  const folders = new Set(), files = [];
  for (const entry of state.entries) {
    if (!entry.name.startsWith(state.path) || entry.name === state.path) continue;
    const rest = entry.name.slice(state.path.length), slash = rest.indexOf("/");
    if (slash >= 0) folders.add(rest.slice(0, slash));
    else if (!entry.isDirectory) files.push({ ...entry, label: rest });
  }
  return [...[...folders].sort().map((label) => ({ label, isDirectory: true })), ...files.sort((a,b) => a.label.localeCompare(b.label))];
}

function render() {
  const parts = state.path.split("/").filter(Boolean), breadcrumbs = $("#breadcrumbs");
  breadcrumbs.replaceChildren();
  [{ label: state.file.name, path: "" }, ...parts.map((label, i) => ({ label, path: `${parts.slice(0, i + 1).join("/")}/` }))].forEach(({ label, path }) => {
    const button = document.createElement("button"); button.className = "crumb"; button.textContent = label;
    button.onclick = () => { state.path = path; $("#searchInput").value = ""; render(); }; breadcrumbs.append(button);
  });
  const items = currentItems(), body = $("#fileList"); body.replaceChildren();
  for (const item of items) {
    const row = body.insertRow();
    const nameCell = row.insertCell(), typeCell = row.insertCell(), sizeCell = row.insertCell(), actionCell = row.insertCell();
    const wrapper = document.createElement("div"); wrapper.className = "entry-name";
    const icon = document.createElement("span"); icon.className = "entry-icon"; icon.textContent = item.isDirectory ? "▰" : "□";
    const button = document.createElement("button"); button.className = "entry-button"; button.textContent = item.label;
    if (item.isDirectory) button.onclick = () => { state.path += `${item.label}/`; render(); };
    wrapper.append(icon, button); nameCell.append(wrapper);
    typeCell.textContent = item.isDirectory ? "Folder" : (item.label.split(".").pop() || "File").toUpperCase();
    sizeCell.textContent = item.isDirectory ? "—" : formatSize(item.size);
    if (!item.isDirectory) { const download = document.createElement("button"); download.className = "download"; download.textContent = "Extract"; download.onclick = () => downloadEntry(item); actionCell.append(download); }
  }
  $("#noResults").hidden = items.length !== 0;
}

async function openArchive(file) {
  try {
    $("#chooseButton").textContent = "Reading…";
    const entries = await parseZip(file);
    state.file = file; state.entries = entries; state.path = "";
    $("#archiveName").textContent = file.name;
    $("#archiveMeta").textContent = `${entries.filter((e) => !e.isDirectory).length.toLocaleString()} files · ${formatSize(file.size)}`;
    $("#emptyView").hidden = true; $("#browserView").hidden = false; $("#notice").hidden = true; render(); scrollTo({ top: 0 });
  } catch (error) { showNotice(error.message, true); }
  finally { $("#chooseButton").textContent = "Choose archive"; }
}
function showNotice(message, onEmpty = false) { const element = onEmpty ? $("#dropZone") : $("#notice"); if (onEmpty) { toast(message); } else { element.textContent = message; element.hidden = false; } }
function toast(message) { const element = $("#toast"); element.textContent = message; element.classList.add("show"); setTimeout(() => element.classList.remove("show"), 4500); }

$("#chooseButton").onclick = () => $("#fileInput").click();
$("#openAnother").onclick = () => $("#fileInput").click();
$("#fileInput").onchange = (event) => event.target.files[0] && openArchive(event.target.files[0]);
$("#searchInput").oninput = render;
const dropZone = $("#dropZone");
["dragenter", "dragover"].forEach((name) => dropZone.addEventListener(name, (event) => { event.preventDefault(); dropZone.classList.add("drag"); }));
["dragleave", "drop"].forEach((name) => dropZone.addEventListener(name, (event) => { event.preventDefault(); dropZone.classList.remove("drag"); }));
dropZone.addEventListener("drop", (event) => event.dataTransfer.files[0] && openArchive(event.dataTransfer.files[0]));
