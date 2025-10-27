const videoEl = document.getElementById("inputVideo");
const drawCanvas = document.getElementById("drawCanvas");
const ctx = drawCanvas.getContext("2d");
const playfieldEl = document.querySelector(".playfield");
const crayonEl = document.getElementById("crayon");
const statusHintEl = document.getElementById("statusHint");
const badgeEl = document.getElementById("pinchBadge");
const finalScreenEl = document.getElementById("finalScreen");
const scoreValueEl = document.getElementById("scoreValue");
const scoreMessageEl = document.getElementById("scoreMessage");
const screenshotButton = document.getElementById("screenshotButton");
const shareButton = document.getElementById("shareButton");
const restartButton = document.getElementById("restartButton");
const scorecardEl = document.getElementById("scorecard");
const threeCanvas = document.getElementById("threeCanvas");

const layerStyles = [
  { color: "#ff2d55", width: 26, alpha: 0.9 },
  { color: "#ff4f6e", width: 16, alpha: 0.6 },
  { color: "#ffd6df", width: 9, alpha: 0.45 }
];

const state = {
  game: "waiting",
  pinchActive: false,
  wasPinching: false,
  hasCrayon: false,
  smoothedPoint: null,
  trail: [],
  cursor: null,
  scoreCircle: null,
  latestScore: 0
};

let drawingBounds = { width: 0, height: 0, left: 0, top: 0, ratio: 1 };
let crayonCenter = { x: 0, y: 0 };
let lastCaptureDataUrl = null;

const smoothingFactor = 0.35;
const pinchThreshold = 0.045;
const pickupRadius = 110;
const minTrailPoints = 30;

function updateBadge(label, mode = "ready") {
  const palette = {
    ready: { bg: "var(--accent)", color: "var(--ink)" },
    active: { bg: "#06d6a0", color: "var(--ink)" },
    drawing: { bg: "#ffd166", color: "var(--ink)" },
    complete: { bg: "#118ab2", color: "var(--neutral)" },
    error: { bg: "#ef476f", color: "var(--neutral)" }
  };
  const style = palette[mode] || palette.ready;
  badgeEl.textContent = label;
  badgeEl.style.background = style.bg;
  badgeEl.style.color = style.color;
}

function resizeCanvases() {
  const rect = playfieldEl.getBoundingClientRect();
  drawingBounds = {
    width: rect.width,
    height: rect.height,
    left: rect.left,
    top: rect.top,
    ratio: window.devicePixelRatio || 1
  };
  drawCanvas.width = rect.width * drawingBounds.ratio;
  drawCanvas.height = rect.height * drawingBounds.ratio;
  drawCanvas.style.width = `${rect.width}px`;
  drawCanvas.style.height = `${rect.height}px`;
  ctx.setTransform(drawingBounds.ratio, 0, 0, drawingBounds.ratio, 0, 0);
  const crayonRect = crayonEl.getBoundingClientRect();
  crayonCenter = {
    x: crayonRect.left - rect.left + crayonRect.width / 2,
    y: crayonRect.top - rect.top + crayonRect.height / 2
  };
  resetTrailDrawing();
  resizeThree();
}

function resetTrailDrawing() {
  drawTrail();
}

function smoothPoint(point) {
  if (!state.smoothedPoint) {
    state.smoothedPoint = { ...point };
  } else {
    state.smoothedPoint.x += smoothingFactor * (point.x - state.smoothedPoint.x);
    state.smoothedPoint.y += smoothingFactor * (point.y - state.smoothedPoint.y);
  }
  return { ...state.smoothedPoint };
}

function addTrailPoint(point) {
  if (!state.trail.length) {
    state.trail.push({ ...point, offsets: buildOffsets() });
    return;
  }
  const lastPoint = state.trail[state.trail.length - 1];
  const distance = Math.hypot(point.x - lastPoint.x, point.y - lastPoint.y);
  if (distance < 3) return;
  state.trail.push({ ...point, offsets: buildOffsets() });
}

function buildOffsets() {
  return layerStyles.map(style => ({
    x: (Math.random() - 0.5) * style.width * 0.35,
    y: (Math.random() - 0.5) * style.width * 0.35
  }));
}

function drawTrail() {
  ctx.clearRect(0, 0, drawingBounds.width, drawingBounds.height);
  if (state.trail.length > 1) {
    layerStyles.forEach((style, layerIndex) => {
      ctx.beginPath();
      const first = state.trail[0];
      const firstOffsets = first.offsets[layerIndex];
      ctx.moveTo(first.x + firstOffsets.x, first.y + firstOffsets.y);
      for (let i = 1; i < state.trail.length; i++) {
        const point = state.trail[i];
        const offsets = point.offsets[layerIndex];
        ctx.lineTo(point.x + offsets.x, point.y + offsets.y);
      }
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = style.width;
      ctx.globalAlpha = style.alpha;
      ctx.strokeStyle = style.color;
      ctx.stroke();
    });
    ctx.globalAlpha = 1;
  }
  if (state.scoreCircle) {
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 6;
    ctx.strokeStyle = "#41f694";
    ctx.beginPath();
    ctx.arc(
      state.scoreCircle.center.x,
      state.scoreCircle.center.y,
      state.scoreCircle.radius,
      0,
      Math.PI * 2
    );
    ctx.stroke();
    ctx.restore();
  }
  if (state.cursor) {
    ctx.save();
    ctx.globalAlpha = state.pinchActive ? 0.9 : 0.5;
    ctx.fillStyle = state.pinchActive ? "#ffe066" : "#ef476f";
    ctx.beginPath();
    ctx.arc(state.cursor.x, state.cursor.y, state.pinchActive ? 16 : 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function updateCursor(point, visible) {
  if (!visible) {
    state.cursor = null;
    return;
  }
  state.cursor = { ...point };
}

function normalizedToCanvas(x, y) {
  const mirroredX = 1 - x;
  return {
    x: mirroredX * drawingBounds.width,
    y: y * drawingBounds.height
  };
}

function handleResults(results) {
  if (!results.multiHandLandmarks || !results.multiHandLandmarks.length) {
    state.pinchActive = false;
    if (state.wasPinching && state.game === "drawing" && state.trail.length >= minTrailPoints) {
      finalizeDrawing();
    }
    state.wasPinching = false;
    updateCursor(null, false);
    drawTrail();
    return;
  }
  const landmarks = results.multiHandLandmarks[0];
  const thumbTip = landmarks[4];
  const indexTip = landmarks[8];
  const pinchDistance = Math.hypot(
    thumbTip.x - indexTip.x,
    thumbTip.y - indexTip.y
  );
  const pinch = pinchDistance < pinchThreshold;
  const pinchMid = {
    x: (thumbTip.x + indexTip.x) / 2,
    y: (thumbTip.y + indexTip.y) / 2
  };
  const canvasPoint = normalizedToCanvas(pinchMid.x, pinchMid.y);
  const smoothed = smoothPoint(canvasPoint);
  updateCursor(smoothed, true);
  state.pinchActive = pinch;

  if (pinch && !state.wasPinching) {
    if (!state.hasCrayon && state.game === "waiting") {
      const distanceToCrayon = Math.hypot(
        smoothed.x - crayonCenter.x,
        smoothed.y - crayonCenter.y
      );
      if (distanceToCrayon < pickupRadius) {
        startDrawing();
      }
    }
  }

  if (state.game === "drawing" && pinch) {
    addTrailPoint(smoothed);
    drawTrail();
  }

  if (!pinch && state.wasPinching && state.game === "drawing") {
    if (state.trail.length >= minTrailPoints) {
      finalizeDrawing();
    } else {
      resetToWaiting();
    }
  }

  if (!pinch) {
    state.smoothedPoint = null;
  }

  state.wasPinching = pinch;
  updateStatusUI();
}

function startDrawing() {
  state.game = "drawing";
  state.hasCrayon = true;
  state.trail = [];
  state.scoreCircle = null;
  state.latestScore = 0;
  lastCaptureDataUrl = null;
  statusHintEl.textContent = "Keep pinching and draw the cleanest circle you can";
  updateBadge("Drawing", "drawing");
  finalScreenEl.classList.add("hidden");
}

function finalizeDrawing() {
  state.game = "completed";
  state.hasCrayon = false;
  state.scoreCircle = evaluateCircle(state.trail);
  state.latestScore = state.scoreCircle ? state.scoreCircle.score : 0;
  state.cursor = null;
  updateBadge("Score", "complete");
  statusHintEl.textContent = "Check your score and play again";
  drawTrail();
  if (state.scoreCircle) {
    scoreValueEl.textContent = state.latestScore.toFixed(0);
    scoreMessageEl.textContent = buildScoreMessage(state.latestScore);
  } else {
    scoreValueEl.textContent = "0";
    scoreMessageEl.textContent = "We lost the trail. Give it another shot.";
  }
  finalScreenEl.classList.remove("hidden");
}

function resetToWaiting() {
  state.game = "waiting";
  state.hasCrayon = false;
  state.trail = [];
  state.scoreCircle = null;
  state.latestScore = 0;
  state.cursor = null;
  state.smoothedPoint = null;
  drawTrail();
  statusHintEl.textContent = "Pinch above to grab the crayon";
  updateBadge("Ready", "ready");
}

function updateStatusUI() {
  if (state.game === "waiting") {
    if (state.pinchActive) {
      updateBadge("Pinched", "active");
    } else {
      updateBadge("Ready", "ready");
    }
  } else if (state.game === "drawing") {
    updateBadge(state.pinchActive ? "Drawing" : "Hold", "drawing");
  }
}

function evaluateCircle(points) {
  if (points.length < 3) return null;
  let sumX = 0;
  let sumY = 0;
  let sumX2 = 0;
  let sumY2 = 0;
  let sumXY = 0;
  let sumX3 = 0;
  let sumY3 = 0;
  let sumX1Y2 = 0;
  let sumX2Y1 = 0;
  let sumZ = 0;
  for (const p of points) {
    const x = p.x;
    const y = p.y;
    const x2 = x * x;
    const y2 = y * y;
    sumX += x;
    sumY += y;
    sumX2 += x2;
    sumY2 += y2;
    sumXY += x * y;
    sumX3 += x2 * x;
    sumY3 += y2 * y;
    sumX1Y2 += x * y2;
    sumX2Y1 += x2 * y;
    sumZ += x2 + y2;
  }
  const n = points.length;
  const A = [
    [sumX2, sumXY, sumX],
    [sumXY, sumY2, sumY],
    [sumX, sumY, n]
  ];
  const B = [
    -(sumX3 + sumX1Y2),
    -(sumX2Y1 + sumY3),
    -sumZ
  ];
  const coeffs = solve3x3(A, B);
  if (!coeffs) return null;
  const [a, b, c] = coeffs;
  const center = {
    x: -a / 2,
    y: -b / 2
  };
  const radiusSq = center.x * center.x + center.y * center.y - c;
  if (radiusSq <= 0) return null;
  const radius = Math.sqrt(radiusSq);
  const tolerance = radius * 0.35 + 24;
  let totalScore = 0;
  for (const p of points) {
    const dist = Math.hypot(p.x - center.x, p.y - center.y);
    const diff = Math.abs(dist - radius);
    const pointScore = Math.max(0, 1 - diff / tolerance);
    totalScore += pointScore;
  }
  const meanScore = totalScore / points.length;
  const closure = Math.hypot(
    points[0].x - points[points.length - 1].x,
    points[0].y - points[points.length - 1].y
  );
  const closureScore = Math.max(0, 1 - closure / (radius * 0.45 + 28));
  const finalScore = Math.max(
    0,
    Math.min(100, meanScore * 90 + closureScore * 10)
  );
  return {
    center,
    radius,
    score: finalScore
  };
}

function solve3x3(A, B) {
  const [a11, a12, a13] = A[0];
  const [a21, a22, a23] = A[1];
  const [a31, a32, a33] = A[2];
  const [b1, b2, b3] = B;
  const det =
    a11 * (a22 * a33 - a23 * a32) -
    a12 * (a21 * a33 - a23 * a31) +
    a13 * (a21 * a32 - a22 * a31);
  if (Math.abs(det) < 1e-9) return null;
  const detX =
    b1 * (a22 * a33 - a23 * a32) -
    a12 * (b2 * a33 - a23 * b3) +
    a13 * (b2 * a32 - a22 * b3);
  const detY =
    a11 * (b2 * a33 - a23 * b3) -
    b1 * (a21 * a33 - a23 * a31) +
    a13 * (a21 * b3 - b2 * a31);
  const detZ =
    a11 * (a22 * b3 - b2 * a32) -
    a12 * (a21 * b3 - b2 * a31) +
    b1 * (a21 * a32 - a22 * a31);
  return [detX / det, detY / det, detZ / det];
}

function buildScoreMessage(score) {
  if (score >= 95) return "Perfect orbit. You crushed it.";
  if (score >= 85) return "It's nearly flawless. Stellar work.";
  if (score >= 70) return "Strong circle. Keep refining that flow.";
  if (score >= 50) return "Decent loop. Slow and steady for more points.";
  return "Keep practicing. Draw slower for a smoother circle.";
}

async function setupCamera() {
  try {
    const camera = new Camera(videoEl, {
      onFrame: async () => {
        await hands.send({ image: videoEl });
      },
      width: 640,
      height: 480
    });
    await camera.start();
  } catch (error) {
    statusHintEl.textContent = "Camera blocked. Enable it to play.";
    updateBadge("No Camera", "error");
    console.error(error);
  }
}

const hands = new Hands({
  locateFile: file => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
});
hands.setOptions({
  maxNumHands: 1,
  modelComplexity: 1,
  minDetectionConfidence: 0.6,
  minTrackingConfidence: 0.6
});
hands.onResults(handleResults);

function initThree() {
  threeRenderer = new THREE.WebGLRenderer({
    canvas: threeCanvas,
    antialias: true
  });
  threeRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  threeScene = new THREE.Scene();
  threeScene.background = new THREE.Color(0x0d1017);
  threeCamera = new THREE.PerspectiveCamera(
    40,
    window.innerWidth / window.innerHeight,
    0.1,
    100
  );
  threeCamera.position.set(0, 0, 14);
  const ambient = new THREE.AmbientLight(0xffffff, 0.5);
  threeScene.add(ambient);
  const dirLight = new THREE.DirectionalLight(0xfff4e6, 1.15);
  dirLight.position.set(6, 7, 5);
  threeScene.add(dirLight);
  const accentLight = new THREE.PointLight(0xff2d55, 1, 40);
  accentLight.position.set(-6, -4, 6);
  threeScene.add(accentLight);
  const group = new THREE.Group();
  threeScene.add(group);
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(5.2, 5.2, 5.2),
    new THREE.MeshStandardMaterial({ color: 0x141821, metalness: 0.1, roughness: 0.4 })
  );
  group.add(box);
  const torus = new THREE.Mesh(
    new THREE.TorusKnotGeometry(2.4, 0.6, 180, 24),
    new THREE.MeshStandardMaterial({ color: 0xff2d55, metalness: 0.25, roughness: 0.2 })
  );
  group.add(torus);
  torus.position.set(-2.2, -0.8, 2.5);
  const bar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.6, 0.6, 7.4, 24),
    new THREE.MeshStandardMaterial({ color: 0x06d6a0, metalness: 0.2, roughness: 0.3 })
  );
  bar.position.set(2.4, 1.8, -1.8);
  bar.rotation.z = Math.PI / 4;
  group.add(bar);
  threeObjects = { group, torus, bar };
  resizeThree();
  animateThree();
}

let threeRenderer;
let threeScene;
let threeCamera;
let threeObjects;

function resizeThree() {
  if (!threeRenderer || !threeCamera) return;
  threeRenderer.setSize(window.innerWidth, window.innerHeight);
  threeCamera.aspect = window.innerWidth / window.innerHeight;
  threeCamera.updateProjectionMatrix();
}

function animateThree() {
  requestAnimationFrame(animateThree);
  if (!threeRenderer || !threeScene || !threeCamera || !threeObjects) return;
  threeObjects.group.rotation.y += 0.0015;
  threeObjects.group.rotation.x += 0.0009;
  threeObjects.torus.rotation.y += 0.014;
  threeObjects.torus.rotation.x += 0.01;
  threeObjects.bar.rotation.y += 0.008;
  threeRenderer.render(threeScene, threeCamera);
}

async function generateScoreImage() {
  if (typeof html2canvas === "undefined") return null;
  const canvas = await html2canvas(scorecardEl, {
    backgroundColor: "#0d1017",
    scale: 2
  });
  const dataUrl = canvas.toDataURL("image/png");
  lastCaptureDataUrl = dataUrl;
  return dataUrl;
}

screenshotButton.addEventListener("click", async () => {
  const dataUrl = await generateScoreImage();
  if (!dataUrl) return;
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = `hand-circle-score-${Date.now()}.png`;
  link.click();
});

shareButton.addEventListener("click", async () => {
  let dataUrl = lastCaptureDataUrl;
  if (!dataUrl) {
    dataUrl = await generateScoreImage();
  }
  if (!dataUrl) {
    const tweetText = encodeURIComponent(
      `I scored ${state.latestScore.toFixed(0)}% in the Hand Circle Challenge! #HandCircleChallenge`
    );
    window.open(`https://twitter.com/intent/tweet?text=${tweetText}`, "_blank");
    return;
  }
  const tweetText = encodeURIComponent(
    `I scored ${state.latestScore.toFixed(0)}% in the Hand Circle Challenge! #HandCircleChallenge`
  );
  const shareUrl = `https://twitter.com/intent/tweet?text=${tweetText}`;
  if (navigator.share) {
    try {
      const response = await fetch(dataUrl);
      const blob = await response.blob();
      const file = new File([blob], "hand-circle-score.png", { type: "image/png" });
      await navigator.share({
        files: [file],
        title: "Hand Circle Challenge",
        text: `I scored ${state.latestScore.toFixed(0)}% in the Hand Circle Challenge!`
      });
      return;
    } catch (error) {
      console.error("Share failed", error);
    }
  }
  window.open(shareUrl, "_blank");
});

restartButton.addEventListener("click", () => {
  finalScreenEl.classList.add("hidden");
  resetToWaiting();
});

window.addEventListener("resize", resizeCanvases);

initThree();
resizeCanvases();
setupCamera();

