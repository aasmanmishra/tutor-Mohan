const canvas = document.getElementById("boardCanvas");
const ctx = canvas.getContext("2d");
const wrap = document.getElementById("canvasWrap");
const emptyState = document.getElementById("emptyState");

const tools = [...document.querySelectorAll(".tool")];
const colorPicker = document.getElementById("colorPicker");
const strokeWidth = document.getElementById("strokeWidth");
const widthValue = document.getElementById("widthValue");
const colorValue = document.getElementById("colorValue");
const objectCount = document.getElementById("objectCount");
const zoomValue = document.getElementById("zoomValue");
const toast = document.getElementById("toast");

let tool = "pen";
let drawing = false;
let start = null;
let current = null;
let zoom = 1;
let strokes = [];
let undone = [];
let grid = true;

function resizeCanvas() {
  const ratio = window.devicePixelRatio || 1;
  const rect = wrap.getBoundingClientRect();

  canvas.width = rect.width * ratio;
  canvas.height = rect.height * ratio;
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;

  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  redraw();
}

function getPoint(event) {
  const rect = canvas.getBoundingClientRect();

  return {
    x: (event.clientX - rect.left) / zoom,
    y: (event.clientY - rect.top) / zoom,
  };
}

function drawItem(item) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = item.color;
  ctx.lineWidth = item.width;
  ctx.globalAlpha = item.tool === "highlighter" ? 0.22 : 1;

  ctx.globalCompositeOperation =
    item.tool === "eraser" ? "destination-out" : "source-over";

  const first = item.points[0];
  const last = item.points[item.points.length - 1];

  ctx.beginPath();

  if (["pen", "highlighter", "eraser"].includes(item.tool)) {
    item.points.forEach((point, index) => {
      if (index === 0) {
        ctx.moveTo(point.x, point.y);
      } else {
        ctx.lineTo(point.x, point.y);
      }
    });

    ctx.stroke();
  } else if (item.tool === "line" || item.tool === "arrow") {
    ctx.moveTo(first.x, first.y);
    ctx.lineTo(last.x, last.y);
    ctx.stroke();

    if (item.tool === "arrow") {
      const angle = Math.atan2(
        last.y - first.y,
        last.x - first.x
      );

      ctx.beginPath();

      ctx.moveTo(last.x, last.y);
      ctx.lineTo(
        last.x - 13 * Math.cos(angle - 0.5),
        last.y - 13 * Math.sin(angle - 0.5)
      );

      ctx.moveTo(last.x, last.y);
      ctx.lineTo(
        last.x - 13 * Math.cos(angle + 0.5),
        last.y - 13 * Math.sin(angle + 0.5)
      );

      ctx.stroke();
    }
  } else if (item.tool === "rectangle") {
    ctx.strokeRect(
      first.x,
      first.y,
      last.x - first.x,
      last.y - first.y
    );
  } else if (item.tool === "circle") {
    ctx.ellipse(
      (first.x + last.x) / 2,
      (first.y + last.y) / 2,
      Math.abs(last.x - first.x) / 2,
      Math.abs(last.y - first.y) / 2,
      0,
      0,
      Math.PI * 2
    );

    ctx.stroke();
  } else if (item.tool === "text") {
    ctx.font = `600 ${Math.max(14, item.width * 4)}px DM Sans`;
    ctx.fillStyle = item.color;
    ctx.fillText(item.text, first.x, first.y);
  }

  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
}

function redraw() {
  const rect = wrap.getBoundingClientRect();

  ctx.clearRect(0, 0, rect.width, rect.height);

  ctx.save();
  ctx.scale(zoom, zoom);

  strokes.forEach(drawItem);

  if (
    drawing &&
    current &&
    start &&
    !["pen", "highlighter", "eraser"].includes(tool)
  ) {
    drawItem({
      tool,
      color: colorPicker.value,
      width: Number(strokeWidth.value),
      points: [start, current],
    });
  }

  ctx.restore();

  objectCount.textContent = strokes.length;
  emptyState.style.display = strokes.length ? "none" : "grid";
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");

  clearTimeout(showToast.timer);

  showToast.timer = setTimeout(() => {
    toast.classList.remove("show");
  }, 1300);
}

function commit(item) {
  strokes.push(item);
  undone = [];
  redraw();
  showToast("Saved");
}

function setTool(nextTool) {
  tool = nextTool;

  tools.forEach((button) => {
    button.classList.toggle(
      "active",
      button.dataset.tool === tool
    );
  });

  canvas.style.cursor = tool === "text" ? "text" : "crosshair";
}

function startDrawing(event) {
  if (event.button !== 0) return;

  drawing = true;
  start = getPoint(event);
  current = start;

  if (tool === "text") {
    const text = prompt("Enter text:");

    drawing = false;

    if (text && text.trim()) {
      commit({
        tool: "text",
        color: colorPicker.value,
        width: Number(strokeWidth.value),
        points: [start],
        text: text.trim(),
      });
    }

    return;
  }

  if (["pen", "highlighter", "eraser"].includes(tool)) {
    strokes.push({
      tool,
      color: colorPicker.value,
      width: Number(strokeWidth.value),
      points: [start],
    });
  }
}

function draw(event) {
  if (!drawing) return;

  current = getPoint(event);

  if (["pen", "highlighter", "eraser"].includes(tool)) {
    strokes[strokes.length - 1].points.push(current);
  }

  redraw();
}

function stopDrawing() {
  if (!drawing) return;

  drawing = false;

  if (["pen", "highlighter", "eraser"].includes(tool)) {
    redraw();
    showToast("Saved");
  } else if (start && current) {
    commit({
      tool,
      color: colorPicker.value,
      width: Number(strokeWidth.value),
      points: [start, current],
    });
  }

  start = null;
  current = null;
}

function undo() {
  if (!strokes.length) return;

  undone.push(strokes.pop());
  redraw();
  showToast("Undone");
}

function redo() {
  if (!undone.length) return;

  strokes.push(undone.pop());
  redraw();
  showToast("Redone");
}

function exportBoard() {
  const link = document.createElement("a");

  link.download =
    `whiteboard-${new Date().toISOString().slice(0, 10)}.png`;

  link.href = canvas.toDataURL("image/png");
  link.click();

  showToast("PNG exported");
}

tools.forEach((button) => {
  button.addEventListener("click", () => {
    setTool(button.dataset.tool);
  });
});

canvas.addEventListener("pointerdown", startDrawing);
canvas.addEventListener("pointermove", draw);

window.addEventListener("pointerup", stopDrawing);
window.addEventListener("resize", resizeCanvas);

document.getElementById("undo").addEventListener("click", undo);
document.getElementById("redo").addEventListener("click", redo);
document
  .getElementById("exportBoard")
  .addEventListener("click", exportBoard);

document
  .getElementById("startDrawing")
  .addEventListener("click", () => setTool("pen"));

document
  .getElementById("clearBoard")
  .addEventListener("click", () => {
    if (strokes.length && confirm("Clear the entire board?")) {
      strokes = [];
      undone = [];
      redraw();
      showToast("Board cleared");
    }
  });

colorPicker.addEventListener("input", () => {
  colorValue.textContent = colorPicker.value.toUpperCase();
});

strokeWidth.addEventListener("input", () => {
  widthValue.textContent = `${strokeWidth.value}px`;
});

document
  .getElementById("toggleGrid")
  .addEventListener("click", () => {
    grid = !grid;
    wrap.classList.toggle("no-grid", !grid);
  });

document
  .getElementById("zoomIn")
  .addEventListener("click", () => {
    zoom = Math.min(2, zoom + 0.1);
    zoomValue.textContent = `${Math.round(zoom * 100)}%`;
    redraw();
  });

document
  .getElementById("zoomOut")
  .addEventListener("click", () => {
    zoom = Math.max(0.5, zoom - 0.1);
    zoomValue.textContent = `${Math.round(zoom * 100)}%`;
    redraw();
  });

document
  .getElementById("renameBoard")
  .addEventListener("click", () => {
    const boardName = document.getElementById("boardName");

    const name = prompt("Board name:", boardName.textContent);

    if (name && name.trim()) {
      boardName.textContent = name.trim();
    }
  });

document.addEventListener("keydown", (event) => {
  const modifier = event.metaKey || event.ctrlKey;

  if (modifier && event.key.toLowerCase() === "z") {
    event.preventDefault();

    if (event.shiftKey) {
      redo();
    } else {
      undo();
    }

    return;
  }

  if (modifier && event.key.toLowerCase() === "y") {
    event.preventDefault();
    redo();
    return;
  }

  if (!modifier) {
    const shortcuts = {
      p: "pen",
      h: "highlighter",
      e: "eraser",
      l: "line",
      r: "rectangle",
      c: "circle",
      a: "arrow",
      t: "text",
    };

    const selectedTool = shortcuts[event.key.toLowerCase()];

    if (selectedTool) {
      setTool(selectedTool);
    }
  }
});

resizeCanvas();