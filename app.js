import { createZip, extractEntry, parseArchive } from "./archive.js?v=native-glm-4";

const $ = (selector) => document.querySelector(selector);
const state = { file: null, entries: [], path: "", format: "" };
function formatSize(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 3);
  return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}
async function downloadEntry(entry) {
  try {
    const blob = await extractEntry(state.file, entry);
    const url = URL.createObjectURL(blob), anchor = document.createElement("a");
    anchor.href = url; anchor.download = entry.name.split("/").pop(); anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    toast(`Extracted ${anchor.download}`);
  } catch (error) { showNotice(error.message); }
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob), anchor = document.createElement("a");
  anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function safeZipName(name) {
  const base = name.replace(/\.(glm|zip)$/i, "").replace(/[^a-z0-9._-]+/gi, "-") || "archive";
  return `${base}.zip`;
}

async function downloadZip(entries, name, button) {
  const originalLabel = button.textContent;
  try {
    button.disabled = true;
    const blob = await createZip(state.file, entries, (done, total) => { button.textContent = `Packing ${done}/${total}…`; });
    downloadBlob(blob, safeZipName(name));
    toast(`Extracted ${entries.length.toLocaleString()} files to ${safeZipName(name)}`);
  } catch (error) { showNotice(error.message); }
  finally { button.disabled = false; button.textContent = originalLabel; }
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
    const download = document.createElement("button"); download.className = "download";
    if (item.isDirectory) {
      download.textContent = "Extract folder";
      download.onclick = () => {
        const prefix = `${state.path}${item.label}/`;
        const entries = state.entries.filter((entry) => !entry.isDirectory && entry.name.startsWith(prefix));
        downloadZip(entries.map((entry) => ({ ...entry, zipName: entry.name.slice(prefix.length) })), item.label, download);
      };
    } else { download.textContent = "Extract"; download.onclick = () => downloadEntry(item); }
    actionCell.append(download);
  }
  $("#noResults").hidden = items.length !== 0;
}

async function openArchive(file) {
  try {
    $("#chooseButton").textContent = "Reading…";
    const { entries, format } = await parseArchive(file);
    state.file = file; state.entries = entries; state.path = ""; state.format = format;
    $("#archiveName").textContent = file.name;
    $("#archiveMeta").textContent = `${format} archive · ${entries.filter((e) => !e.isDirectory).length.toLocaleString()} files · ${formatSize(file.size)}`;
    $("#emptyView").hidden = true; $("#browserView").hidden = false; $("#notice").hidden = true; render(); scrollTo({ top: 0 });
  } catch (error) { showNotice(error.message, true); }
  finally { $("#chooseButton").textContent = "Choose archive"; }
}
function showNotice(message, onEmpty = false) { const element = onEmpty ? $("#dropZone") : $("#notice"); if (onEmpty) { toast(message); } else { element.textContent = message; element.hidden = false; } }
function toast(message) { const element = $("#toast"); element.textContent = message; element.classList.add("show"); setTimeout(() => element.classList.remove("show"), 4500); }

$("#chooseButton").onclick = () => $("#fileInput").click();
$("#openAnother").onclick = () => $("#fileInput").click();
$("#extractAll").onclick = (event) => downloadZip(state.entries.filter((entry) => !entry.isDirectory), state.file.name, event.currentTarget);
$("#fileInput").onchange = (event) => event.target.files[0] && openArchive(event.target.files[0]);
$("#searchInput").oninput = render;
const dropZone = $("#dropZone");
["dragenter", "dragover"].forEach((name) => dropZone.addEventListener(name, (event) => { event.preventDefault(); dropZone.classList.add("drag"); }));
["dragleave", "drop"].forEach((name) => dropZone.addEventListener(name, (event) => { event.preventDefault(); dropZone.classList.remove("drag"); }));
dropZone.addEventListener("drop", (event) => event.dataTransfer.files[0] && openArchive(event.dataTransfer.files[0]));
