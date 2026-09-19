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

  // TEACHERS: one entry per teacher. Each teacher has their OWN passcode.
  //   name  = shown to students and written in attendance/recording file names
  //   hash  = SHA-256 of that teacher's passcode. Make it with make-passcode-hash.html
  //   rooms = (optional) only these rooms can be hosted with this passcode
  // To remove a teacher, delete their line and upload config.js again. Their passcode stops working.
  // (The first hash below = "change-me-123". The app warns you until you replace it.)
  TEACHERS: [
    { name: "Mohan Sir",  hash: "8eb2961d9750214f76ff37133422ee3f48100588caa32566007a6d33bea8b5fc" },
      { name: "lallu Sir",   hash: "33ad8fe9d0c35060a5fdcbd7f05a4dab7f39c9a1fcb4b2d86969db78066f4547" },
    // { name: "Priya Madam", hash: "PASTE-HASH-HERE", rooms: ["maths-batch-a", "maths-batch-b"] },
  ],

  /* ---------- Optional ---------- */
  PUBLIC_URL: "",            // e.g. "https://YOURNAME.github.io/REPO/". Empty = automatic
  EXTRA_ICE_SERVERS: []      // TURN server for strict school networks, e.g. { urls: "turn:host:3478", username: "u", credential: "p" }
};
