/* =====================  EDIT THIS FILE  =====================
   Everything you need to customise lives here. */
window.MEETING_CONFIG = {
  // Name shown in the app and browser tab
  APP_NAME: "My Meeting App",

  // Default room. Students opening the plain link land here.
  // Make it long and random so strangers can't guess it.
  ROOM: "SampleAppWorseParkingsCutOpenly",

  // Keeps your rooms separate from other apps on the free PeerJS server.
  // Change to something unique to you (letters/numbers/dashes).
  NAMESPACE: "tutormohan",

  // SHA-256 hash of the teacher passcode (NOT the passcode itself).
  // Default hash below = "change-me-123".  Make your own by opening
  // make-passcode-hash.html in your browser, then paste the result here.
  HOST_PASSCODE_HASH: "8eb2961d9750214f76ff37133422ee3f48100588caa32566007a6d33bea8b5fc",

  // Optional: your public page address, e.g. "https://YOURNAME.github.io/REPO/"
  // Leave "" to use the current address automatically.
  PUBLIC_URL: "",

  // Optional TURN server for strict school/office networks, e.g.
  // { urls: "turn:host:3478", username: "u", credential: "p" }
  EXTRA_ICE_SERVERS: []
};
