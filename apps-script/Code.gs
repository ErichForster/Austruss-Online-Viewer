/**
 * Austruss Online Viewer — Drive backend (list, download, save).
 *
 * Deploy as a Web App (Deploy > New deployment > type: Web app):
 *   - Execute as: Me
 *   - Who has access: Anyone
 * Then paste the deployment's /exec URL into public/drive-config.json's
 * "scriptUrl" field. See README.md "Google Drive setup" for the full steps.
 *
 * This replaces the Google Cloud Console / API key approach entirely —
 * everything (browsing, downloading, saving) goes through this one script,
 * running under whichever Google account deploys it. Nobody viewing the
 * site needs to sign in; the script acts on your behalf.
 *
 * Why text/plain for doPost: a POST with Content-Type: application/json
 * triggers a CORS preflight (an OPTIONS request) that Apps Script Web Apps
 * don't handle, so the browser blocks the whole request before it runs.
 * Content-Type: text/plain is a CORS "simple request" — no preflight,
 * works reliably from fetch(). The client sends JSON as the body text
 * regardless; this only parses it manually instead of relying on the
 * header. GET requests (list, download) don't have this problem — GET is
 * always a simple request no matter the content, so those are plain fetch()
 * calls with no special handling needed.
 */

var ALLOWED_EXTENSIONS = [".ifc", ".frag"];

function doGet(e) {
  var action = (e.parameter.action || "").trim();

  if (action === "list") {
    return handleList(e);
  }
  if (action === "download") {
    return handleDownload(e);
  }
  return jsonResponse({ status: "ok", message: "Austruss Online Viewer backend is running." });
}

function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);
    var filename = String(payload.filename || "").trim();
    var contentBase64 = payload.contentBase64;
    var folderId = String(payload.folderId || "").trim();

    var hasAllowedExtension = ALLOWED_EXTENSIONS.some(function (ext) {
      return filename.toLowerCase().indexOf(ext) !== -1;
    });
    if (!filename || !hasAllowedExtension) {
      return jsonResponse({ success: false, error: "Filename must end in " + ALLOWED_EXTENSIONS.join(" or ") });
    }
    if (!contentBase64) {
      return jsonResponse({ success: false, error: "No file content received" });
    }
    if (!folderId) {
      return jsonResponse({ success: false, error: "No target folder ID provided" });
    }

    var folder = getFolderOrError(folderId);
    if (folder.error) return jsonResponse(folder.error);

    var bytes = Utilities.base64Decode(contentBase64);
    var blob = Utilities.newBlob(bytes, "application/octet-stream", filename);

    // Overwrite-by-name: if a file with this exact name already exists in
    // the folder, replace it instead of creating a duplicate — keeps
    // re-saves of the same drawing from piling up as "(1)", "(2)"...
    // Binary content can't be safely patched in place via setContent(), so
    // this trashes the old file and creates a fresh one with the same name.
    var existing = folder.folder.getFilesByName(filename);
    var wasOverwrite = existing.hasNext();
    if (wasOverwrite) {
      existing.next().setTrashed(true);
    }
    var file = folder.folder.createFile(blob);

    return jsonResponse({
      success: true,
      fileId: file.getId(),
      webViewLink: file.getUrl(),
      overwritten: wasOverwrite,
    });
  } catch (err) {
    return jsonResponse({ success: false, error: String(err) });
  }
}

// Recursively lists every .ifc/.frag file under the given folder ID,
// walking subfolders the same way the old Drive-API-based catalog did.
function handleList(e) {
  var folderId = String(e.parameter.folderId || "").trim();
  if (!folderId) {
    return jsonResponse({ success: false, error: "No folderId provided" });
  }
  var root = getFolderOrError(folderId);
  if (root.error) return jsonResponse(root.error);

  var results = [];
  var pending = [root.folder];

  while (pending.length) {
    var current = pending.shift();
    var files = current.getFiles();
    while (files.hasNext()) {
      var file = files.next();
      var name = file.getName();
      var lower = name.toLowerCase();
      if (lower.indexOf(".ifc") !== -1 || lower.indexOf(".frag") !== -1) {
        results.push({
          id: file.getId(),
          name: name,
          mimeType: file.getMimeType(),
          size: String(file.getSize()),
          modifiedTime: file.getLastUpdated().toISOString(),
        });
      }
    }
    var subfolders = current.getFolders();
    while (subfolders.hasNext()) {
      pending.push(subfolders.next());
    }
  }

  return jsonResponse({ success: true, files: results });
}

// Returns a single file's content as base64 — used by the viewer to load
// a model straight from a catalog link.
function handleDownload(e) {
  var fileId = String(e.parameter.fileId || "").trim();
  if (!fileId) {
    return jsonResponse({ success: false, error: "No fileId provided" });
  }
  try {
    var file = DriveApp.getFileById(fileId);
    var blob = file.getBlob();
    return jsonResponse({
      success: true,
      name: file.getName(),
      mimeType: blob.getContentType(),
      contentBase64: Utilities.base64Encode(blob.getBytes()),
    });
  } catch (err) {
    return jsonResponse({ success: false, error: "Can't access file " + fileId + " — " + String(err) });
  }
}

function getFolderOrError(folderId) {
  try {
    return { folder: DriveApp.getFolderById(folderId) };
  } catch (err) {
    return {
      error: {
        success: false,
        error: "Can't access folder " + folderId + " — check the ID and that this script's account has access",
      },
    };
  }
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
