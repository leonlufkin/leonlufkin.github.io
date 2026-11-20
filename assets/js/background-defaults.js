/* Deterministic theme defaults, independent of generated catalogs and Good sets. */
(function () {
  function device() {
    var touchPhone = matchMedia("(pointer: coarse)").matches && Math.min(innerWidth, innerHeight) <= 620;
    return innerWidth <= 620 || touchPhone ? "mobile" : "laptop";
  }
  var light = { u: "/assets/images/skydiving.svg", c: "#72bcf6", l: "Monterey Bay",
    width: 1721, height: 771, edge: { sides: "#72bcf6", caps: "#9bd4fb" }, layered: true,
    preload: ["/assets/images/skydiving-sky.svg", "/assets/images/skydiving-coast.svg", "/assets/images/skydiving-diver.svg"] };
  var dark = { u: "/assets/backgrounds/dark/home_moon2.jpg", c: "#010203", l: "Home",
    width: 1600, height: 1200, edge: { sides: "#010101", caps: "#010102" } };
  window.SiteBackgroundDefaults = { version: 7, device: device,
    get: function (mode) { return mode === "dark" ? dark : light; } };
})();
