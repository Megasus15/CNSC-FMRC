/* jshint esversion: 9 */
/**
 * Ready-made hero background gradients — red/maroon shades only.
 *
 * Loaded by the customer home page and by Website Management → Home in both the
 * admin and staff portals, so a swatch in the picker and the live hero are the
 * same declaration rather than two lists that drift apart.
 *
 * `base` is the brand gradient. `css()` layers the hero's two decorative
 * highlights over it (the same ones .hero-section ships with in main.css) so a
 * preset keeps the glass/graphic feel instead of reading as a flat wash;
 * `swatch()` swaps those highlights for percentage-sized twins so a 120px
 * preview tile shows the same balance a full-width hero does.
 */
(function () {
  "use strict";

  var SHEEN_HERO =
    "radial-gradient(circle at 78% 18%, rgba(241, 237, 18, 0.28), transparent 14rem), " +
    "radial-gradient(circle at 14% 20%, rgba(255, 255, 255, 0.18), transparent 18rem)";

  var SHEEN_SWATCH =
    "radial-gradient(circle at 78% 18%, rgba(241, 237, 18, 0.3), transparent 52%), " +
    "radial-gradient(circle at 14% 20%, rgba(255, 255, 255, 0.2), transparent 58%)";

  var PRESETS = [
    {
      id: "maroon-ember",
      label: "Maroon Ember",
      base: "linear-gradient(130deg, #4f0909 0%, #8b0000 42%, #c33425 100%)",
    },
    {
      id: "crimson-dusk",
      label: "Crimson Dusk",
      base: "linear-gradient(145deg, #7f0606 0%, #b01c1c 44%, #d32525 100%)",
    },
    {
      id: "deep-garnet",
      label: "Deep Garnet",
      base: "linear-gradient(160deg, #2e0505 0%, #6b0f0f 48%, #a11919 100%)",
    },
    {
      id: "brick-fade",
      label: "Brick Fade",
      base: "linear-gradient(120deg, #8c1c13 0%, #c0392b 55%, #e15b45 100%)",
    },
    {
      id: "wine-velvet",
      label: "Wine Velvet",
      base: "linear-gradient(135deg, #3d0713 0%, #7b1226 46%, #b02b3c 100%)",
    },
    {
      id: "oxblood-night",
      label: "Oxblood Night",
      base: "linear-gradient(150deg, #1c0303 0%, #5a0b0b 50%, #8f1717 100%)",
    },
    {
      id: "scarlet-sweep",
      label: "Scarlet Sweep",
      base: "linear-gradient(115deg, #6d0000 0%, #a80f0f 40%, #e04a2f 100%)",
    },
    {
      id: "rosewood-glow",
      label: "Rosewood Glow",
      base: "linear-gradient(135deg, #5c0a0a 0%, #9e1414 40%, #d8552a 100%)",
    },
  ];

  var DEFAULT_ID = "maroon-ember";

  function find(id) {
    var wanted = String(id || "");
    for (var i = 0; i < PRESETS.length; i++) {
      if (PRESETS[i].id === wanted) return PRESETS[i];
    }
    return null;
  }

  /** The preset, or the default one when the stored id is blank/unknown. */
  function resolve(id) {
    return find(id) || find(DEFAULT_ID) || PRESETS[0];
  }

  window.FMRC_HERO_GRADIENTS = {
    DEFAULT_ID: DEFAULT_ID,
    presets: PRESETS.slice(),
    find: find,
    resolve: resolve,
    /** Full background stack for .hero-section. */
    css: function (id) {
      return SHEEN_HERO + ", " + resolve(id).base;
    },
    /** Same look, scaled for a small preview tile. */
    swatch: function (id) {
      return SHEEN_SWATCH + ", " + resolve(id).base;
    },
  };
})();
