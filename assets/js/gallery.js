/* Photo previews and local editing of the Laptop/Mobile background sets. */
(function () {
  var api = window.SiteBackgrounds;
  if (!api) return;
  var root = document.documentElement;
  var editor = ["localhost", "127.0.0.1", "[::1]"].indexOf(location.hostname) !== -1;
  var DRAFT_KEY = "background-gallery-draft-v1";
  var activeDevice = api.device();
  var saved = copy(api.selections());
  var draft = copy(saved);
  var gallery, grid, status, count, saveButton, tabs = {}, rows = [];
  var saving = false, open = false;

  function copy(data) {
    return { laptop: (data.laptop || []).slice(), mobile: (data.mobile || []).slice() };
  }

  function signature(data) {
    return JSON.stringify({ laptop: data.laptop.slice().sort(), mobile: data.mobile.slice().sort() });
  }

  function dirty() { return signature(draft) !== signature(saved); }

  function keepDraft() {
    if (!editor) return;
    try {
      if (dirty()) localStorage.setItem(DRAFT_KEY, JSON.stringify({ base: signature(saved), selections: draft, device: activeDevice }));
      else localStorage.removeItem(DRAFT_KEY);
    } catch (e) {}
  }

  if (editor) {
    try {
      var previous = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
      if (previous && previous.base === signature(saved) && previous.selections &&
          Array.isArray(previous.selections.laptop) && Array.isArray(previous.selections.mobile)) {
        var known = api.all().map(function (e) { return e.u; });
        ["laptop", "mobile"].forEach(function (device) {
          draft[device] = previous.selections[device].filter(function (u, i, a) {
            return known.indexOf(u) !== -1 && a.indexOf(u) === i;
          });
        });
        if (previous.device === "laptop" || previous.device === "mobile") activeDevice = previous.device;
      }
    } catch (e) {}
  }

  function make(tag, className, text) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = text;
    return el;
  }

  function thumbnail(url) {
    return url.replace("/light/", "/thumbs/").replace("/dark/", "/thumbs/");
  }

  function say(text, error) {
    if (!status) return;
    status.textContent = text;
    status.classList.toggle("is-error", !!error);
  }

  function updateControls() {
    if (!editor || !gallery) return;
    ["laptop", "mobile"].forEach(function (device) {
      tabs[device].textContent = (device === "laptop" ? "Laptop" : "Mobile") + " (" + draft[device].length + ")";
      tabs[device].setAttribute("aria-selected", String(activeDevice === device));
    });
    count.textContent = draft[activeDevice].length + " of " + api.all().length + " photos in the " + activeDevice + " good set";
    rows.forEach(function (row) {
      row.checkbox.checked = draft[activeDevice].indexOf(row.entry.u) !== -1;
      row.checkbox.setAttribute("aria-label", "Include " + row.name + " in the " + activeDevice + " good set");
      row.figure.classList.toggle("is-good", row.checkbox.checked);
    });
    saveButton.disabled = saving || !dirty() || !draft.laptop.length || !draft.mobile.length;
    saveButton.textContent = saving ? "Saving…" : "Save selections";
  }

  function updatePreview() {
    if (!gallery) return;
    var current = api.current();
    rows.forEach(function (row) {
      var active = !!current && current.u === row.entry.u;
      row.preview.setAttribute("aria-pressed", String(active));
      row.figure.classList.toggle("is-preview", active);
    });
  }

  function close() {
    open = false;
    root.classList.remove("gallery-open");
    if (gallery) gallery.setAttribute("aria-hidden", "true");
    button.setAttribute("aria-expanded", "false");
    button.focus();
  }

  function renderPhotos() {
    while (grid.firstChild) grid.removeChild(grid.firstChild);
    rows = [];
    var entries = editor ? api.all() : api.galleryPool();
    entries.forEach(function (entry) {
      var name = entry.l || entry.u.split("/").pop().replace(/\.jpg$/, "");
      var figure = make("figure", "gallery-photo");
      var preview = make("button", "gallery-preview");
      preview.type = "button";
      preview.setAttribute("aria-label", "Preview " + name);
      var img = make("img");
      img.loading = "lazy";
      img.decoding = "async";
      img.src = thumbnail(entry.u);
      img.alt = name;
      preview.appendChild(img);
      preview.addEventListener("click", function () {
        if (editor) api.preview(entry);
        else api.choose(entry);
        updatePreview();
        close();
      });
      figure.appendChild(preview);
      figure.appendChild(make("figcaption", "", name + (entry.extension ? " · Soft extension" : "")));
      var row = { entry: entry, name: name, figure: figure, preview: preview };
      if (editor) {
        var label = make("label", "gallery-good");
        var checkbox = make("input");
        checkbox.type = "checkbox";
        checkbox.addEventListener("change", function () {
          var chosen = draft[activeDevice];
          var index = chosen.indexOf(entry.u);
          if (checkbox.checked && index === -1) chosen.push(entry.u);
          if (!checkbox.checked && index !== -1) chosen.splice(index, 1);
          keepDraft();
          updateControls();
          say(!draft.laptop.length || !draft.mobile.length ? "Keep at least one photo in each set." : dirty() ? "Unsaved changes" : "Selections match the saved sets.");
        });
        label.appendChild(checkbox);
        label.appendChild(make("span", "", "Good"));
        figure.appendChild(label);
        row.checkbox = checkbox;
      }
      rows.push(row);
      grid.appendChild(figure);
    });
    if (!entries.length) grid.appendChild(make("p", "gallery-empty", "No photos available for this screen."));
    updateControls();
    updatePreview();
  }

  function save() {
    if (saving || !dirty() || !draft.laptop.length || !draft.mobile.length) return;
    var submitted = copy(draft);
    saving = true;
    updateControls();
    say("Saving selections…");
    fetch("/__background-selection", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(submitted)
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (!response.ok) throw new Error(data.error || "Could not save selections. Please try again.");
        var result = data.selections || data;
        if (!Array.isArray(result.laptop) || !Array.isArray(result.mobile)) throw new Error("The server did not confirm the saved selections.");
        return result;
      });
    }).then(function (result) {
      // Keep changes made while the request was in flight as a fresh draft.
      var changedAgain = signature(draft) !== signature(submitted);
      saved = copy(result);
      if (!changedAgain) draft = copy(result);
      api.setSelections(saved);
      keepDraft();
      say(changedAgain ? "Saved. You have more unsaved changes." : "Saved for laptop and mobile.");
    }).catch(function (error) {
      say(error.message || "Could not save selections. Please try again.", true);
    }).then(function () {
      saving = false;
      updateControls();
    });
  }

  function build() {
    gallery = make("section");
    gallery.id = "gallery";
    gallery.setAttribute("role", "dialog");
    gallery.setAttribute("aria-modal", "true");
    gallery.setAttribute("aria-labelledby", "gallery-title");
    gallery.setAttribute("aria-hidden", "true");
    var toolbar = make("div", "gallery-toolbar");
    var heading = make("h1", "", "Photos");
    heading.id = "gallery-title";
    toolbar.appendChild(heading);
    var dismiss = make("button", "gallery-close", "×");
    dismiss.type = "button";
    dismiss.setAttribute("aria-label", "Close gallery");
    dismiss.addEventListener("click", close);
    toolbar.appendChild(dismiss);
    toolbar.appendChild(make("p", "gallery-help", editor ? "Click a photo to preview it on the page. Check Good separately to include it." : "Click a photo to use it as the background."));
    if (editor) {
      var tablist = make("div", "gallery-tabs");
      tablist.setAttribute("role", "tablist");
      tablist.setAttribute("aria-label", "Background sets");
      ["laptop", "mobile"].forEach(function (device) {
        var tab = make("button", "gallery-tab");
        tab.type = "button";
        tab.setAttribute("role", "tab");
        tab.setAttribute("aria-controls", "gallery-grid");
        tab.addEventListener("click", function () {
          activeDevice = device;
          keepDraft();
          updateControls();
        });
        tabs[device] = tab;
        tablist.appendChild(tab);
      });
      toolbar.appendChild(tablist);
      count = make("p", "gallery-count");
      toolbar.appendChild(count);
      var actions = make("div", "gallery-actions");
      saveButton = make("button", "gallery-save", "Save selections");
      saveButton.type = "button";
      saveButton.addEventListener("click", save);
      actions.appendChild(saveButton);
      status = make("p", "gallery-status");
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");
      actions.appendChild(status);
      toolbar.appendChild(actions);
    }
    gallery.appendChild(toolbar);
    grid = make("div", "gallery-grid");
    grid.id = "gallery-grid";
    gallery.appendChild(grid);
    document.body.appendChild(gallery);
    renderPhotos();
    say(dirty() ? "Unsaved changes" : "");
  }

  function show() {
    if (!gallery) build();
    else if (!editor) renderPhotos();
    else { updateControls(); updatePreview(); }
    open = true;
    gallery.setAttribute("aria-hidden", "false");
    root.classList.add("gallery-open");
    button.setAttribute("aria-expanded", "true");
    gallery.querySelector(".gallery-close").focus();
  }

  var button = make("button", "theme-toggle gallery-btn", "▦");
  button.type = "button";
  button.setAttribute("aria-label", "Photo gallery");
  button.setAttribute("aria-controls", "gallery");
  button.setAttribute("aria-expanded", "false");
  button.addEventListener("click", function () { if (open) close(); else show(); });
  function mount() {
    var nav = document.querySelector("nav");
    if (nav) nav.appendChild(button);
  }
  mount();
  window.addEventListener("pageswap", mount);
  window.addEventListener("backgroundchange", updatePreview);
  window.addEventListener("backgroundgeometrychange", function () {
    if (!editor && gallery) renderPhotos();
  });
  window.addEventListener("backgroundselectionchange", function () {
    if (!dirty()) { saved = copy(api.selections()); draft = copy(saved); }
    if (gallery) { if (editor) updateControls(); else renderPhotos(); }
  });
  document.addEventListener("keydown", function (event) {
    if (!open) return;
    if (event.key === "Escape") { event.preventDefault(); close(); }
    if (event.key === "Tab") {
      var focusable = gallery.querySelectorAll("button:not([disabled]), input:not([disabled])");
      var first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
})();
