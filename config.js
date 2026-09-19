/* =====================  EDIT THIS FILE  =====================
   Everything you need to customise lives here. */
window.MEETING_CONFIG = {
  /* ---------- Branding ---------- */
  APP_NAME: "My Meeting App",            // shown in the top bar, join screen and browser tab
  TAGLINE: "Live online classes",        // small line under the name on the join screen
  WELCOME_TEXT: "Welcome! Enter your name to join today's class.",
  LOGO: "🎓",                            // an emoji, OR a picture file you upload, e.g. "logo.png"
  BRAND_COLOR: "#1a73e8",                // main colour of buttons and highlights (any hex colour)
  TEACHER_LABEL: "",                     // optional: name students see on your video, e.g. "Mohan Sir". Empty = the name you type at login
  FOOTER_TEXT: "",                       // optional small text at the bottom of the join screen, e.g. "© 2026 Mohan Tutorials"

  /* ---------- Room & security ---------- */
  ROOM: "SampleAppWorseParkingsCutOpenly", // default room. Make it long and random!
  NAMESPACE: "tutormohan",                 // unique to you (letters/numbers/dashes)

  // SHA-256 hash of the teacher passcode (NOT the passcode itself).
  // Make yours with make-passcode-hash.html, then paste it here.
  // (This default hash = "change-me-123". The app warns you until you change it.)
  HOST_PASSCODE_HASH: "8eb2961d9750214f76ff37133422ee3f48100588caa32566007a6d33bea8b5fc",

  /* ---------- Optional ---------- */
  PUBLIC_URL: "",            // e.g. "https://YOURNAME.github.io/REPO/". Empty = automatic
  EXTRA_ICE_SERVERS: []      // TURN server for strict school networks, e.g. { urls: "turn:host:3478", username: "u", credential: "p" }
};
