import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import * as CANNON from 'cannon-es';

// Game State
const gameState = {
    stars: 0,
    totalStars: 5,
    level: 1,
    isPlaying: false,
    currentTool: 'ramp',
    placedObjects: [],
    starObjects: [],
    isDragging: false,
    dragStart: null,
    dragEnd: null
};

// Editor State - replace existing
const editorState = {
    isEditorMode: false,
    currentTool: 'select',  // Changed default to select
    levelObjects: {
        stars: [],
        bowl: { x: 0, y: -11.5, z: 0 },
        walls: [],
        boosters: [],
        spikes: []
    }
};

// Selection state for mouse mode
const selectionState = {
    selectedObject: null,
    isDraggingObject: false,
    dragOffset: new THREE.Vector3(),
    mouseDownPos: null,
    mouseDownTime: 0,
    hasDragged: false
};

// Editor preview state
const previewState = {
    ghostMesh: null,
    portalPlacingFirst: true  // true = placing portal A, false = placing portal B
};

// Test mode state
const testModeState = {
    isTesting: false,
    savedLevelCode: null
};

const toolInfo = {
    select: { icon: '🖱️', name: 'Select & Move' },
    star: { icon: '⭐', name: 'Star' },
    bowl: { icon: '🥣', name: 'Bowl' },
    wall: { icon: '🧱', name: 'Wall' },
    booster: { icon: '🌈', name: 'Speed Pad' },
    spike: { icon: '🔺', name: 'Spike' },
    portal: { icon: '🌀', name: 'Portal' },
    delete: { icon: '🗑️', name: 'Delete' }
};

// Cached DOM elements for performance
const domCache = {
    starCount: null,
    levelDisplay: null,
    previewInfo: null,
    winModal: null,
    toolIndicator: null,
    toolIndicatorIcon: null,
    toolIndicatorName: null,
    editorToolbar: null,
    btnEditor: null,
    btnTest: null,
    btnStop: null,
    lockedToast: null,
    menuOverlay: null,
    levelsGrid: null
};

function initDOMCache() {
    domCache.starCount = document.getElementById('star-count');
    domCache.levelDisplay = document.getElementById('level-display');
    domCache.previewInfo = document.getElementById('preview-info');
    domCache.winModal = document.getElementById('win-modal');
    domCache.toolIndicator = document.getElementById('tool-indicator');
    domCache.toolIndicatorIcon = document.getElementById('tool-indicator-icon');
    domCache.toolIndicatorName = document.getElementById('tool-indicator-name');
    domCache.editorToolbar = document.getElementById('editor-toolbar');
    domCache.btnEditor = document.getElementById('btn-editor');
    domCache.btnTest = document.getElementById('btn-test');
    domCache.btnStop = document.getElementById('btn-stop');
    domCache.lockedToast = document.getElementById('locked-toast');
    domCache.menuOverlay = document.getElementById('menu-overlay');
    domCache.levelsGrid = document.getElementById('levels-grid');
}
// Menu State
const menuState = {
    levels: [],
    completedLevels: JSON.parse(localStorage.getItem('ballDropCompleted') || '[]'),
    maxUnlocked: 1
};

// Load all available levels
async function loadAllLevelData() {
    menuState.levels = [];
    let levelNum = 1;

    while (true) {
        try {
            const response = await fetch(`levels/level${levelNum}.txt`);
            if (!response.ok) break;
            const code = await response.text();
            menuState.levels.push({
                num: levelNum,
                code: code
            });
            levelNum++;
        } catch (e) {
            break;
        }
    }

    // If no levels found, create a default
    if (menuState.levels.length === 0) {
        menuState.levels.push({
            num: 1,
            code: `BALL:0,12,0
BOWL:0,-11.1,0
STAR:-5,8,0
STAR:5,6,0
STAR:-3,2,0
STAR:4,-2,0
STAR:0,-6,0`
        });
    }

    updateMaxUnlocked();
    renderLevelMenu();
}

// Render level select menu
function renderLevelMenu() {
    const grid = domCache.levelsGrid;
    grid.innerHTML = '';

    menuState.levels.forEach((level, index) => {
        const levelNum = index + 1;
        const isCompleted = menuState.completedLevels.includes(levelNum);
        const isUnlocked = levelNum <= menuState.maxUnlocked;
        const isCurrent = levelNum === menuState.maxUnlocked && !isCompleted;

        const card = document.createElement('button');
        card.className = 'level-card';
        if (isCompleted) card.classList.add('completed');
        else if (isCurrent) card.classList.add('current');
        else if (!isUnlocked) card.classList.add('locked');

        card.innerHTML = `
            <span class="level-number">${levelNum}</span>
            ${isCompleted ? '<span class="level-stars">⭐⭐⭐⭐⭐</span>' : ''}
            ${!isUnlocked && !isCurrent ? '<span class="level-lock">🔒</span>' : ''}
        `;

        card.addEventListener('click', () => handleLevelSelect(levelNum, isUnlocked || isCurrent, card));
        grid.appendChild(card);
    });
}

// Handle level selection
function handleLevelSelect(levelNum, isUnlocked, cardElement) {
    if (!isUnlocked) {
        cardElement.classList.add('shake');
        setTimeout(() => cardElement.classList.remove('shake'), 500);
        showToast('🔒 Complete the previous level first!');
        return;
    }

    gameState.level = levelNum;
    const levelData = menuState.levels[levelNum - 1];
    if (levelData) {
        loadLevelFromCode(levelData.code);
    }
    domCache.levelDisplay.textContent = `Level ${levelNum}`;
    domCache.menuOverlay.classList.add('hidden');
}

// Show toast message
function showToast(message) {
    domCache.lockedToast.textContent = message;
    domCache.lockedToast.classList.add('visible');
    setTimeout(() => domCache.lockedToast.classList.remove('visible'), 2000);
}

// Show menu
function showMenu() {
    updateMaxUnlocked();
    renderLevelMenu();
    domCache.menuOverlay.classList.remove('hidden');
}

// Mark level as completed
function completeLevel(levelNum) {
    if (!menuState.completedLevels.includes(levelNum)) {
        menuState.completedLevels.push(levelNum);
        localStorage.setItem('ballDropCompleted', JSON.stringify(menuState.completedLevels));
        updateMaxUnlocked();
    }
}

// Calculate max unlocked level
function updateMaxUnlocked() {
    menuState.maxUnlocked = 1;
    for (let i = 1; i <= menuState.levels.length; i++) {
        if (menuState.completedLevels.includes(i)) {
            menuState.maxUnlocked = Math.max(menuState.maxUnlocked, i + 1);
        }
    }
}

// Add portals to editorObjects
const editorObjects = {
    walls: [],
    boosters: [],
    spikes: [],
    portals: []
};

// Audio setup for collision sounds
const collisionSound = new Audio('knock2.wav');
collisionSound.volume = 0.5;
let lastCollisionTime = 0;
const collisionCooldown = 50; // ms between sounds to prevent spam

// Camera follow state
let isFollowing = false;
let orbitAngle = 0;
const orbitSpeed = 0.5;
const followDistance = 10;
const followLerp = 0.05;
const zoomLerp = 0.03;

let cameraTargetPos = null;
let cameraLookTarget = null;
let isTransitioningToFollow = false;
let isOrbiting = false;
// Ground contact tracking
let groundContactTime = 0;
const groundResetDelay = 3000; // 3 seconds in ms

// Trail system
const trailPositions = [];
const trailMeshes = [];
const maxTrailLength = 25;
const trailSpacing = 0.1; // Minimum distance between trail points

// Star burst particles
const burstParticles = [];
// Landing dust particles
const dustParticles = [];
// Confetti particles
const confettiParticles = [];

// Squash and stretch state
let lastBallVelocityY = 0;
let ballSquashAmount = 1;
let ballStretchAmount = 1;

function playCollisionSound(impactVelocity) {
    const now = Date.now();
    if (now - lastCollisionTime < collisionCooldown) return;
    if (impactVelocity < 2) return; // Only play for meaningful impacts

    lastCollisionTime = now;

    // Clone the audio for overlapping sounds
    const sound = collisionSound.cloneNode();
    // Scale volume based on impact strength (0.2 to 0.8)
    sound.volume = Math.min(0.8, Math.max(0.2, impactVelocity / 15));
    sound.play().catch(() => { }); // Ignore autoplay errors
}

// Three.js Setup
const container = document.getElementById('game-container');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf5f5f7);

// Environment map for reflections
const rgbeLoader = new RGBELoader();
rgbeLoader.load('backgrounds/moon.hdr', (texture) => {
    texture.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = texture;

    // Create a large sphere for the sky that you can move through
    const skyGeometry = new THREE.SphereGeometry(200, 64, 64);
    const skyMaterial = new THREE.MeshBasicMaterial({
        map: texture,
        side: THREE.BackSide
    });
    const skySphere = new THREE.Mesh(skyGeometry, skyMaterial);
    scene.add(skySphere);
});

// Remove the static background
scene.background = null;

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 0, 30);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.insertBefore(renderer.domElement, container.firstChild);

// Orbit Controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.minDistance = 10;
controls.maxDistance = 50;
controls.maxPolarAngle = Math.PI / 2.1;

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
directionalLight.position.set(10, 20, 10);
directionalLight.castShadow = true;
directionalLight.shadow.mapSize.width = 2048;
directionalLight.shadow.mapSize.height = 2048;
directionalLight.shadow.camera.near = 0.5;
directionalLight.shadow.camera.far = 50;
directionalLight.shadow.camera.left = -20;
directionalLight.shadow.camera.right = 20;
directionalLight.shadow.camera.top = 20;
directionalLight.shadow.camera.bottom = -20;
directionalLight.shadow.autoUpdate = false;
directionalLight.shadow.needsUpdate = true;
scene.add(directionalLight);

const fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
fillLight.position.set(-5, 10, -5);
scene.add(fillLight);

// Cannon.js Physics World
const world = new CANNON.World();
world.gravity.set(0, -15, 0);
world.broadphase = new CANNON.NaiveBroadphase();
world.solver.iterations = 10;

// Materials
const ballMaterial = new CANNON.Material('ball');
const groundMaterial = new CANNON.Material('ground');
const rampMaterial = new CANNON.Material('ramp');

const ballGroundContact = new CANNON.ContactMaterial(ballMaterial, groundMaterial, {
    friction: 0.3,
    restitution: 0.4
});
const ballRampContact = new CANNON.ContactMaterial(ballMaterial, rampMaterial, {
    friction: 0.2,
    restitution: 0.3
});
world.addContactMaterial(ballGroundContact);
world.addContactMaterial(ballRampContact);

// Ground cylinder (matches rounded visual)
const groundShape = new CANNON.Cylinder(22, 22, 1, 32);
const groundBody = new CANNON.Body({ mass: 0, material: groundMaterial });
groundBody.addShape(groundShape);
groundBody.position.y = -12.5;
world.addBody(groundBody);

// Visual ground - rounded disc with beveled edge
const groundRadius = 22;
const groundGroup = new THREE.Group();

// Main disc
const discGeometry = new THREE.CircleGeometry(groundRadius, 64);
const groundMaterialThree = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.15,
    metalness: 0.85,
    envMapIntensity: 1.2
});
const discMesh = new THREE.Mesh(discGeometry, groundMaterialThree);
discMesh.rotation.x = -Math.PI / 2;
discMesh.receiveShadow = true;
groundGroup.add(discMesh);

// Beveled edge ring
const edgeGeometry = new THREE.TorusGeometry(groundRadius, 0.5, 16, 64);
const edgeMaterial = new THREE.MeshStandardMaterial({
    color: 0xcccccc,
    roughness: 0.2,
    metalness: 0.9,
    envMapIntensity: 1.0
});
const edgeMesh = new THREE.Mesh(edgeGeometry, edgeMaterial);
edgeMesh.rotation.x = Math.PI / 2;
edgeMesh.position.y = -0.25;
edgeMesh.castShadow = true;
edgeMesh.receiveShadow = true;
groundGroup.add(edgeMesh);


groundGroup.position.y = -12;
scene.add(groundGroup);

// Ball
let ball, ballBody;
const ballRadius = 0.5;
const ballStartPosition = new THREE.Vector3(0, 12, 0);

function createBall() {
    // Remove existing ball
    if (ball) scene.remove(ball);
    if (ballBody) world.removeBody(ballBody);

    // Three.js ball
    const ballGeometry = new THREE.SphereGeometry(ballRadius, 32, 32);
    const ballMaterialThree = new THREE.MeshStandardMaterial({
        color: 0x0071e3,
        roughness: 0.1,
        metalness: 0.8,
        envMapIntensity: 1.0
    });
    ball = new THREE.Mesh(ballGeometry, ballMaterialThree);
    ball.castShadow = true;
    ball.position.copy(ballStartPosition);
    scene.add(ball);

    // Cannon.js ball
    const ballShape = new CANNON.Sphere(ballRadius);
    ballBody = new CANNON.Body({
        mass: 1,
        material: ballMaterial,
        linearDamping: 0.1,
        angularDamping: 0.3
    });
    ballBody.addShape(ballShape);
    ballBody.position.copy(ballStartPosition);
    world.addBody(ballBody);

    // Start frozen
    ballBody.type = CANNON.Body.STATIC;
    // Listen for collisions
    ballBody.addEventListener('collide', (event) => {
        const impactVelocity = event.contact.getImpactVelocityAlongNormal();
        playCollisionSound(Math.abs(impactVelocity));
    });
}
function updateTrail() {
    if (!gameState.isPlaying || !ball) return;

    const currentPos = ball.position.clone();

    // Only add point if ball moved enough
    if (trailPositions.length === 0 ||
        currentPos.distanceTo(trailPositions[trailPositions.length - 1]) > trailSpacing) {

        trailPositions.push(currentPos);

        // Create trail sphere
        const trailGeometry = new THREE.SphereGeometry(ballRadius * 0.8, 16, 16);
        const trailMaterial = new THREE.MeshStandardMaterial({
            color: 0x0071e3,
            transparent: true,
            opacity: 0.6,
            emissive: 0x0071e3,
            emissiveIntensity: 0.3
        });
        const trailMesh = new THREE.Mesh(trailGeometry, trailMaterial);
        trailMesh.position.copy(currentPos);
        scene.add(trailMesh);
        trailMeshes.push(trailMesh);
    }

    // Limit trail length
    while (trailPositions.length > maxTrailLength) {
        trailPositions.shift();
        const oldMesh = trailMeshes.shift();
        scene.remove(oldMesh);
        oldMesh.geometry.dispose();
        oldMesh.material.dispose();
    }

    // Update trail opacity and scale (fade out older segments)
    trailMeshes.forEach((mesh, i) => {
        const age = (i + 1) / trailMeshes.length;
        mesh.material.opacity = age * 0.5;
        const scale = 0.3 + age * 0.7;
        mesh.scale.setScalar(scale);
    });
}

function clearTrail() {
    trailPositions.length = 0;
    trailMeshes.forEach(mesh => {
        scene.remove(mesh);
        mesh.geometry.dispose();
        mesh.material.dispose();
    });
    trailMeshes.length = 0;
}
// Bowl (target)
let bowl, bowlBody;
const bowlPosition = new THREE.Vector3(0, -11.5, 0);

function createBowl() {
    // Visual bowl
    const bowlGroup = new THREE.Group();

    // Outer bowl shape
    const bowlGeometry = new THREE.CylinderGeometry(2.5, 1.5, 1.5, 32, 1, true);
    const bowlMaterialThree = new THREE.MeshStandardMaterial({
        color: 0x34c759,
        roughness: 0.2,
        metalness: 0.6,
        side: THREE.DoubleSide,
        envMapIntensity: 0.8
    });
    const bowlMesh = new THREE.Mesh(bowlGeometry, bowlMaterialThree);
    bowlMesh.castShadow = true;
    bowlMesh.receiveShadow = true;
    bowlGroup.add(bowlMesh);

    // Bowl bottom - thin disc raised slightly to avoid z-fighting
    const bottomGeometry = new THREE.CircleGeometry(1.5, 32);
    const bottomMesh = new THREE.Mesh(bottomGeometry, bowlMaterialThree);
    bottomMesh.rotation.x = -Math.PI / 2;
    bottomMesh.position.y = -0.73;
    bottomMesh.renderOrder = 1;
    bowlGroup.add(bottomMesh);

    // Glow ring
    const ringGeometry = new THREE.TorusGeometry(2.5, 0.08, 16, 100);
    const ringMaterial = new THREE.MeshBasicMaterial({ color: 0x34c759 });
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.75;
    bowlGroup.add(ring);

    // Position bowl so it sits on the ground
    // Position bowl so it sits on the ground (raised slightly to avoid z-fighting)
    bowlPosition.set(0, -11.1, 0);
    bowlGroup.position.copy(bowlPosition);
    scene.add(bowlGroup);
    bowl = bowlGroup;

    // Physics body with collision
    bowlBody = new CANNON.Body({ mass: 0, material: groundMaterial });

    // Bowl walls - use angled boxes around the perimeter
    const numSegments = 16;
    const wallThickness = 0.15;
    const wallHeight = 1.5;

    for (let i = 0; i < numSegments; i++) {
        const angle = (i / numSegments) * Math.PI * 2;
        const nextAngle = ((i + 1) / numSegments) * Math.PI * 2;

        // Average radius at this segment (bowl tapers from 2.5 at top to 1.5 at bottom)
        const topRadius = 2.5;
        const bottomRadius = 1.5;
        const avgRadius = (topRadius + bottomRadius) / 2;

        // Segment length
        const segmentLength = avgRadius * (nextAngle - angle);

        const wallShape = new CANNON.Box(new CANNON.Vec3(segmentLength / 2 + 0.1, wallHeight / 2, wallThickness / 2));

        const x = Math.cos(angle + (nextAngle - angle) / 2) * avgRadius;
        const z = Math.sin(angle + (nextAngle - angle) / 2) * avgRadius;

        const wallQuat = new CANNON.Quaternion();
        wallQuat.setFromEuler(0, -angle - Math.PI / 2, 0);

        bowlBody.addShape(wallShape, new CANNON.Vec3(x, 0, z), wallQuat);
    }

    // Bowl bottom - flat disc
    const bottomShape = new CANNON.Cylinder(1.5, 1.5, 0.2, 16);
    const bottomQuat = new CANNON.Quaternion();
    bottomQuat.setFromEuler(0, 0, 0);
    bowlBody.addShape(bottomShape, new CANNON.Vec3(0, -0.65, 0), bottomQuat);

    bowlBody.position.copy(bowlPosition);
    world.addBody(bowlBody);
}
// Stars
function createStars() {
    // Clear existing stars
    gameState.starObjects.forEach(obj => {
        scene.remove(obj.mesh);
        if (obj.body) world.removeBody(obj.body);
    });
    gameState.starObjects = [];
    gameState.stars = 0;
    updateStarDisplay();

    // Star positions for level
    const starPositions = [
        new THREE.Vector3(-5, 8, 0),
        new THREE.Vector3(5, 6, 0),
        new THREE.Vector3(-3, 2, 0),
        new THREE.Vector3(4, -2, 0),
        new THREE.Vector3(0, -6, 0)
    ];

    // Vary positions slightly based on level
    starPositions.forEach((pos, i) => {
        pos.x += (gameState.level - 1) * (i % 2 === 0 ? 1 : -1);
        pos.y += Math.sin(gameState.level * i) * 0.5;
    });

    starPositions.forEach((pos, index) => {
        createStar(pos, index);
    });
}

function createStar(position, index) {
    // Create star shape
    const starShape = new THREE.Shape();
    const outerRadius = 0.5;
    const innerRadius = 0.2;
    const spikes = 5;

    for (let i = 0; i < spikes * 2; i++) {
        const radius = i % 2 === 0 ? outerRadius : innerRadius;
        const angle = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius;
        if (i === 0) starShape.moveTo(x, y);
        else starShape.lineTo(x, y);
    }
    starShape.closePath();

    const extrudeSettings = { depth: 0.15, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05 };
    const starGeometry = new THREE.ExtrudeGeometry(starShape, extrudeSettings);
    const starMaterial = new THREE.MeshStandardMaterial({
        color: 0xffcc00,
        roughness: 0.2,
        metalness: 0.8,
        emissive: 0xff9500,
        emissiveIntensity: 0.8
    });

    const starGroup = new THREE.Group();

    const star = new THREE.Mesh(starGeometry, starMaterial);
    star.castShadow = true;
    starGroup.add(star);

    // Add point light for glow effect
    const starLight = new THREE.PointLight(0xff9500, 2, 5);
    starLight.position.set(0, 0, 0.5);
    starGroup.add(starLight);

    // Add glow sprite
    const glowTexture = createGlowTexture();
    const glowMaterial = new THREE.SpriteMaterial({
        map: glowTexture,
        color: 0xff9500,
        transparent: true,
        blending: THREE.AdditiveBlending,
        opacity: 0.6
    });
    const glowSprite = new THREE.Sprite(glowMaterial);
    glowSprite.scale.set(3, 3, 1);
    starGroup.add(glowSprite);

    starGroup.position.copy(position);
    starGroup.userData.index = index;
    starGroup.userData.collected = false;
    starGroup.userData.light = starLight;
    starGroup.userData.glow = glowSprite;
    scene.add(starGroup);

    // Physics sensor
    const sphereShape = new CANNON.Sphere(0.6);
    const starBody = new CANNON.Body({ mass: 0, isTrigger: true });
    starBody.addShape(sphereShape);
    starBody.position.copy(position);
    world.addBody(starBody);

    gameState.starObjects.push({ mesh: starGroup, body: starBody, collected: false });
}
let sharedGlowTexture = null;
function createGlowTexture() {
    if (sharedGlowTexture) return sharedGlowTexture;

    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');

    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255, 200, 100, 1)');
    gradient.addColorStop(0.3, 'rgba(255, 150, 0, 0.5)');
    gradient.addColorStop(1, 'rgba(255, 100, 0, 0)');

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);

    sharedGlowTexture = new THREE.CanvasTexture(canvas);
    return sharedGlowTexture;
}

// Create wall
function createWall(start, end) {
    const startVec = new THREE.Vector3(start.x, start.y, start.z);
    const endVec = new THREE.Vector3(end.x, end.y, end.z);
    const direction = endVec.clone().sub(startVec);
    const length = direction.length();
    if (length < 0.5) return null;

    const center = startVec.clone().add(endVec).multiplyScalar(0.5);

    // Visual
    const geometry = new THREE.BoxGeometry(length, 0.5, 1);
    const material = new THREE.MeshStandardMaterial({
        color: 0x8e8e93,
        roughness: 0.3,
        metalness: 0.5
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(center);
    const angle = Math.atan2(direction.y, direction.x);
    mesh.rotation.z = angle;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);

    // Physics
    const shape = new CANNON.Box(new CANNON.Vec3(length / 2, 0.25, 0.5));
    const body = new CANNON.Body({ mass: 0, material: groundMaterial });
    body.addShape(shape);
    body.position.copy(center);
    body.quaternion.setFromEuler(0, 0, angle);
    world.addBody(body);

    const wallData = { mesh, body, start: { ...start }, end: { ...end }, type: 'wall' };
    editorObjects.walls.push(wallData);
    return wallData;
}

// Create booster
// Create booster (rainbow speed pad)
function createBooster(start, end) {
    const startVec = new THREE.Vector3(start.x, start.y, start.z);
    const endVec = new THREE.Vector3(end.x, end.y, end.z);
    const direction = endVec.clone().sub(startVec);
    const length = direction.length();
    if (length < 0.5) return null;

    const center = startVec.clone().add(endVec).multiplyScalar(0.5);
    const angle = Math.atan2(direction.y, direction.x);

    // Rainbow gradient material using vertex colors
    const geometry = new THREE.BoxGeometry(length, 0.15, 2, 10, 1, 1);

    // Apply rainbow colors to vertices
    const colors = [];
    const positions = geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i);
        const t = (x / length) + 0.5; // normalize to 0-1
        const color = new THREE.Color();
        color.setHSL(t, 1, 0.5);
        colors.push(color.r, color.g, color.b);
    }
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    const material = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.3,
        metalness: 0.7,
        emissive: 0xffffff,
        emissiveIntensity: 0.1
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(center);
    mesh.rotation.z = angle;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);

    // Physics body
    const shape = new CANNON.Box(new CANNON.Vec3(length / 2, 0.075, 1));
    const body = new CANNON.Body({ mass: 0, material: rampMaterial });
    body.addShape(shape);
    body.position.copy(center);
    body.quaternion.setFromEuler(0, 0, angle);
    world.addBody(body);

    // Store boost direction (along the pad)
    const boostDir = direction.clone().normalize();

    const boosterData = {
        mesh,
        body,
        start: { ...start },
        end: { ...end },
        center: { x: center.x, y: center.y, z: center.z },
        direction: { x: boostDir.x, y: boostDir.y, z: boostDir.z },
        length,
        angle,
        type: 'booster'
    };
    editorObjects.boosters.push(boosterData);
    return boosterData;
}

// Create portal
function createPortal(position, isPortalA = true) {
    const color = isPortalA ? 0xff6b00 : 0x00b3ff; // Orange for A, Blue for B

    // Outer ring
    const ringGeometry = new THREE.TorusGeometry(0.8, 0.12, 16, 32);
    const ringMaterial = new THREE.MeshStandardMaterial({
        color: color,
        emissive: color,
        emissiveIntensity: 0.5,
        roughness: 0.2,
        metalness: 0.8
    });
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);

    // Inner swirl effect
    const innerGeometry = new THREE.CircleGeometry(0.65, 32);
    const innerMaterial = new THREE.MeshBasicMaterial({
        color: color,
        transparent: true,
        opacity: 0.3,
        side: THREE.DoubleSide
    });
    const inner = new THREE.Mesh(innerGeometry, innerMaterial);

    const group = new THREE.Group();
    group.add(ring);
    group.add(inner);
    group.position.set(position.x, position.y, position.z);
    group.userData.isPortalA = isPortalA;
    group.userData.portalColor = color;
    scene.add(group);

    const portalData = {
        mesh: group,
        position: { ...position },
        isPortalA,
        linkedPortal: null,
        type: 'portal'
    };

    return portalData;
}

// Create portal pair
function createPortalPair(posA, posB) {
    const portalA = createPortal(posA, true);
    const portalB = createPortal(posB, false);

    // Link them
    portalA.linkedPortal = portalB;
    portalB.linkedPortal = portalA;

    editorObjects.portals.push(portalA);
    editorObjects.portals.push(portalB);

    return { portalA, portalB };
}

// Temporary portal storage for placement
let pendingPortal = null;
// Create spike
function createSpike(position) {
    // Raycast down to find the lowest platform/ground
    const raycaster = new THREE.Raycaster();
    raycaster.set(new THREE.Vector3(position.x, position.y, position.z), new THREE.Vector3(0, -1, 0));

    // Collect all meshes to check against
    const meshesToCheck = [];
    scene.traverse((obj) => {
        if (obj.isMesh && obj !== ball) {
            meshesToCheck.push(obj);
        }
    });

    const intersects = raycaster.intersectObjects(meshesToCheck);

    let targetY = -12; // Default to ground level
    let surfaceNormal = new THREE.Vector3(0, 1, 0);

    if (intersects.length > 0) {
        targetY = intersects[0].point.y;
        if (intersects[0].face) {
            surfaceNormal = intersects[0].face.normal.clone();
            intersects[0].object.getWorldQuaternion(new THREE.Quaternion());
            surfaceNormal.applyQuaternion(intersects[0].object.quaternion);
        }
    }

    // Single red cone
    const spikeGeo = new THREE.ConeGeometry(0.3, 1, 8);
    const spikeMaterial = new THREE.MeshStandardMaterial({
        color: 0xff2d55,
        emissive: 0xff2d55,
        emissiveIntensity: 0.3,
        roughness: 0.3,
        metalness: 0.6
    });
    const spike = new THREE.Mesh(spikeGeo, spikeMaterial);
    spike.castShadow = true;

    // Position at the surface
    spike.position.set(position.x, targetY + 0.5, position.z);

    // Align to surface normal
    const up = new THREE.Vector3(0, 1, 0);
    const quaternion = new THREE.Quaternion().setFromUnitVectors(up, surfaceNormal);
    spike.quaternion.copy(quaternion);

    scene.add(spike);

    // Collision body
    const shape = new CANNON.Sphere(0.4);
    const body = new CANNON.Body({ mass: 0, isTrigger: true });
    body.addShape(shape);
    body.position.set(position.x, targetY + 0.5, position.z);
    world.addBody(body);

    const spikeData = { mesh: spike, body, position: { x: position.x, y: targetY + 0.5, z: position.z }, type: 'spike' };
    editorObjects.spikes.push(spikeData);
    return spikeData;
}
// Create ghost preview mesh
function createGhostPreview(tool, position) {
    clearGhostPreview();

    let ghost = null;

    switch (tool) {
        case 'star':
            const starShape = new THREE.Shape();
            const outerRadius = 0.5;
            const innerRadius = 0.2;
            for (let i = 0; i < 10; i++) {
                const radius = i % 2 === 0 ? outerRadius : innerRadius;
                const angle = (i / 10) * Math.PI * 2 - Math.PI / 2;
                const x = Math.cos(angle) * radius;
                const y = Math.sin(angle) * radius;
                if (i === 0) starShape.moveTo(x, y);
                else starShape.lineTo(x, y);
            }
            starShape.closePath();
            const starGeo = new THREE.ExtrudeGeometry(starShape, { depth: 0.15, bevelEnabled: false });
            ghost = new THREE.Mesh(starGeo, new THREE.MeshBasicMaterial({ color: 0xff9500, transparent: true, opacity: 0.4 }));
            break;

        case 'bowl':
            const bowlGeo = new THREE.CylinderGeometry(2.5, 1.5, 1.5, 32, 1, true);
            ghost = new THREE.Mesh(bowlGeo, new THREE.MeshBasicMaterial({ color: 0x34c759, transparent: true, opacity: 0.4, side: THREE.DoubleSide }));
            break;

        case 'spike':
            const spikeGeo = new THREE.ConeGeometry(0.3, 1, 8);
            ghost = new THREE.Mesh(spikeGeo, new THREE.MeshBasicMaterial({ color: 0xff2d55, transparent: true, opacity: 0.4 }));
            break;

        case 'portal':
            const portalGeo = new THREE.TorusGeometry(0.8, 0.12, 16, 32);
            const portalColor = previewState.portalPlacingFirst ? 0xff6b00 : 0x00b3ff;
            ghost = new THREE.Mesh(portalGeo, new THREE.MeshBasicMaterial({ color: portalColor, transparent: true, opacity: 0.4 }));
            break;

        case 'delete':
            const deleteGeo = new THREE.RingGeometry(0.5, 0.7, 32);
            ghost = new THREE.Mesh(deleteGeo, new THREE.MeshBasicMaterial({ color: 0xff2d55, transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
            break;
    }

    if (ghost) {
        ghost.position.copy(position);
        ghost.className = 'ghost-preview';
        scene.add(ghost);
        previewState.ghostMesh = ghost;
    }
}

// Update ghost preview position
function updateGhostPreview(position) {
    if (previewState.ghostMesh) {
        previewState.ghostMesh.position.copy(position);
    }
}

// Clear ghost preview
function clearGhostPreview() {
    if (previewState.ghostMesh) {
        scene.remove(previewState.ghostMesh);
        previewState.ghostMesh = null;
    }
}

// Update tool indicator
function updateToolIndicator(tool) {
    if (editorState.isEditorMode && toolInfo[tool]) {
        domCache.toolIndicator.classList.add('visible');
        domCache.toolIndicatorIcon.textContent = toolInfo[tool].icon;
        domCache.toolIndicatorName.textContent = toolInfo[tool].name;

        if (tool === 'portal') {
            domCache.toolIndicatorName.textContent = previewState.portalPlacingFirst ? 'Portal A (Orange)' : 'Portal B (Blue)';
        }
    } else {
        domCache.toolIndicator.classList.remove('visible');
    }
}
// Create spike at exact position (for loading levels)
function createSpikeAtPosition(position) {
    const spikeGeo = new THREE.ConeGeometry(0.3, 1, 8);
    const spikeMaterial = new THREE.MeshStandardMaterial({
        color: 0xff2d55,
        emissive: 0xff2d55,
        emissiveIntensity: 0.3,
        roughness: 0.3,
        metalness: 0.6
    });
    const spike = new THREE.Mesh(spikeGeo, spikeMaterial);
    spike.castShadow = true;
    spike.position.set(position.x, position.y, position.z);
    scene.add(spike);

    const shape = new CANNON.Sphere(0.4);
    const body = new CANNON.Body({ mass: 0, isTrigger: true });
    body.addShape(shape);
    body.position.set(position.x, position.y, position.z);
    world.addBody(body);

    const spikeData = { mesh: spike, body, position: { ...position }, type: 'spike' };
    editorObjects.spikes.push(spikeData);
    return spikeData;
}
function generateLevelCode() {
    const lines = [];

    // Ball start position
    lines.push(`BALL:${ballStartPosition.x},${ballStartPosition.y},${ballStartPosition.z}`);

    // Bowl
    lines.push(`BOWL:${bowlPosition.x.toFixed(2)},${bowlPosition.y.toFixed(2)},${bowlPosition.z.toFixed(2)}`);

    // Stars
    gameState.starObjects.forEach(star => {
        const pos = star.mesh.position;
        lines.push(`STAR:${pos.x.toFixed(2)},${pos.y.toFixed(2)},${pos.z.toFixed(2)}`);
    });

    // Walls
    editorObjects.walls.forEach(wall => {
        lines.push(`WALL:${wall.start.x.toFixed(2)},${wall.start.y.toFixed(2)},${wall.start.z.toFixed(2)},${wall.end.x.toFixed(2)},${wall.end.y.toFixed(2)},${wall.end.z.toFixed(2)}`);
    });

    // Boosters (new format with start/end)
    editorObjects.boosters.forEach(booster => {
        lines.push(`BOOSTER:${booster.start.x.toFixed(2)},${booster.start.y.toFixed(2)},${booster.start.z.toFixed(2)},${booster.end.x.toFixed(2)},${booster.end.y.toFixed(2)},${booster.end.z.toFixed(2)}`);
    });

    // Spikes
    editorObjects.spikes.forEach(spike => {
        lines.push(`SPIKE:${spike.position.x.toFixed(2)},${spike.position.y.toFixed(2)},${spike.position.z.toFixed(2)}`);
    });

    // Portals (save as pairs)
    const savedPortals = new Set();
    editorObjects.portals.forEach(portal => {
        if (savedPortals.has(portal)) return;
        if (portal.linkedPortal) {
            lines.push(`PORTAL:${portal.position.x.toFixed(2)},${portal.position.y.toFixed(2)},${portal.position.z.toFixed(2)},${portal.linkedPortal.position.x.toFixed(2)},${portal.linkedPortal.position.y.toFixed(2)},${portal.linkedPortal.position.z.toFixed(2)}`);
            savedPortals.add(portal);
            savedPortals.add(portal.linkedPortal);
        }
    });

    // Ramps
    gameState.placedObjects.forEach(obj => {
        if (obj.type === 'ramp') {
            const pos = obj.mesh.position;
            const rot = obj.mesh.rotation.z;
            const scale = obj.mesh.geometry.parameters.width;
            lines.push(`RAMP:${pos.x.toFixed(2)},${pos.y.toFixed(2)},${pos.z.toFixed(2)},${rot.toFixed(3)},${scale.toFixed(2)}`);
        }
    });

    return lines.join('\n');
}
// Parse level code
function parseLevelCode(code) {
    const data = {
        ball: { x: 0, y: 12, z: 0 },
        bowl: { x: 0, y: -11.5, z: 0 },
        stars: [],
        walls: [],
        boosters: [],
        spikes: [],
        portals: [],
        ramps: []
    };

    const lines = code.trim().split('\n');
    lines.forEach(line => {
        const [type, params] = line.split(':');
        if (!params) return;
        const values = params.split(',').map(Number);

        switch (type) {
            case 'BALL':
                data.ball = { x: values[0], y: values[1], z: values[2] };
                break;
            case 'BOWL':
                data.bowl = { x: values[0], y: values[1], z: values[2] };
                break;
            case 'STAR':
                data.stars.push({ x: values[0], y: values[1], z: values[2] });
                break;
            case 'WALL':
                data.walls.push({
                    start: { x: values[0], y: values[1], z: values[2] },
                    end: { x: values[3], y: values[4], z: values[5] }
                });
                break;
            case 'BOOSTER':
                // New format: start and end positions
                if (values.length >= 6) {
                    data.boosters.push({
                        start: { x: values[0], y: values[1], z: values[2] },
                        end: { x: values[3], y: values[4], z: values[5] }
                    });
                }
                break;
            case 'SPIKE':
                data.spikes.push({ x: values[0], y: values[1], z: values[2] });
                break;
            case 'PORTAL':
                data.portals.push({
                    a: { x: values[0], y: values[1], z: values[2] },
                    b: { x: values[3], y: values[4], z: values[5] }
                });
                break;
            case 'RAMP':
                data.ramps.push({
                    position: { x: values[0], y: values[1], z: values[2] },
                    rotation: values[3],
                    length: values[4]
                });
                break;
        }
    });

    return data;
}
// Load level from code
function loadLevelFromCode(code) {
    const data = parseLevelCode(code);

    // Clear everything
    clearLevel();

    // Set ball start
    ballStartPosition.set(data.ball.x, data.ball.y, data.ball.z);

    // Set bowl position
    bowlPosition.set(data.bowl.x, data.bowl.y, data.bowl.z);
    bowl.position.copy(bowlPosition);
    bowlBody.position.copy(bowlPosition);

    // Create stars
    data.stars.forEach((pos, index) => {
        createStar(new THREE.Vector3(pos.x, pos.y, pos.z), index);
    });
    gameState.totalStars = data.stars.length;
    updateStarDisplay();

    // Create walls
    data.walls.forEach(wall => {
        createWall(wall.start, wall.end);
    });

    // Create boosters (new format)
    data.boosters.forEach(booster => {
        createBooster(booster.start, booster.end);
    });

    // Create spikes
    data.spikes.forEach(spike => {
        createSpikeAtPosition(spike);
    });

    // Create portals
    data.portals.forEach(portalPair => {
        createPortalPair(portalPair.a, portalPair.b);
    });

    // Create ramps from level data
    data.ramps.forEach(ramp => {
        createRampFromData(ramp);
    });

    resetBall();
    directionalLight.shadow.needsUpdate = true;
}
// Create ramp from saved data
function createRampFromData(data) {
    const length = data.length;
    const geometry = new THREE.BoxGeometry(length, 0.2, 2);
    const material = new THREE.MeshStandardMaterial({
        color: 0xaf52de,
        roughness: 0.4,
        metalness: 0.2
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(data.position.x, data.position.y, data.position.z);
    mesh.rotation.z = data.rotation;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);

    const shape = new CANNON.Box(new CANNON.Vec3(length / 2, 0.1, 1));
    const body = new CANNON.Body({ mass: 0, material: rampMaterial });
    body.addShape(shape);
    body.position.set(data.position.x, data.position.y, data.position.z);
    body.quaternion.setFromEuler(0, 0, data.rotation);
    world.addBody(body);

    gameState.placedObjects.push({ mesh, body, type: 'ramp' });
}

// Clear entire level
function clearLevel() {
    // Clear stars
    gameState.starObjects.forEach(obj => {
        scene.remove(obj.mesh);
        if (obj.body) world.removeBody(obj.body);
    });
    gameState.starObjects = [];

    // Clear walls
    editorObjects.walls.forEach(obj => {
        scene.remove(obj.mesh);
        if (obj.body) world.removeBody(obj.body);
    });
    editorObjects.walls = [];

    // Clear boosters
    editorObjects.boosters.forEach(obj => {
        scene.remove(obj.mesh);
        if (obj.body) world.removeBody(obj.body);
    });
    editorObjects.boosters = [];

    // Clear spikes
    editorObjects.spikes.forEach(obj => {
        scene.remove(obj.mesh);
        if (obj.body) world.removeBody(obj.body);
    });
    editorObjects.spikes = [];

    // Clear portals
    editorObjects.portals.forEach(obj => {
        scene.remove(obj.mesh);
    });
    editorObjects.portals = [];

    // Clear pending portal
    if (pendingPortal) {
        scene.remove(pendingPortal.mesh);
        pendingPortal = null;
    }
    previewState.portalPlacingFirst = true;

    // Clear ramps
    clearAllRamps();
}
// Load level from file
async function loadLevelFile(levelNum) {
    try {
        const response = await fetch(`levels/level${levelNum}.txt`);
        if (!response.ok) throw new Error('Level not found');
        const code = await response.text();
        loadLevelFromCode(code);
        document.getElementById('level-display').textContent = `Level ${levelNum}`;
        return true;
    } catch (e) {
        console.log(`Level ${levelNum} not found, using default`);
        return false;
    }
}
// Ramp creation
function createRamp(start, end, type = 'ramp') {
    const startVec = new THREE.Vector3(start.x, start.y, start.z);
    const endVec = new THREE.Vector3(end.x, end.y, end.z);

    const direction = endVec.clone().sub(startVec);
    const length = direction.length();
    if (length < 0.5) return null;

    const center = startVec.clone().add(endVec).multiplyScalar(0.5);

    const mesh = createRampMesh(length, center, direction);
    const body = createRampBody(length, center, direction);

    if (mesh && body) {
        scene.add(mesh);
        world.addBody(body);
        gameState.placedObjects.push({ mesh, body, type: 'ramp' });
        return { mesh, body };
    }
    return null;
}
function createRampMesh(length, center, direction) {
    const geometry = new THREE.BoxGeometry(length, 0.2, 2);
    const material = new THREE.MeshStandardMaterial({
        color: 0xaf52de,
        roughness: 0.4,
        metalness: 0.2
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(center);

    // Calculate rotation
    const angle = Math.atan2(direction.y, direction.x);
    mesh.rotation.z = angle;

    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
}

function createRampBody(length, center, direction) {
    const shape = new CANNON.Box(new CANNON.Vec3(length / 2, 0.1, 1));
    const body = new CANNON.Body({ mass: 0, material: rampMaterial });
    body.addShape(shape);
    body.position.copy(center);

    const angle = Math.atan2(direction.y, direction.x);
    body.quaternion.setFromEuler(0, 0, angle);

    return body;
}


// Preview ramp
let previewMesh = null;

function updatePreview(start, end) {
    if (previewMesh) {
        scene.remove(previewMesh);
        previewMesh = null;
    }

    if (!start || !end) return;

    const direction = new THREE.Vector3().subVectors(end, start);
    const length = direction.length();
    if (length < 0.3) return;

    const center = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);

    const geometry = new THREE.BoxGeometry(length, 0.2, 2);
    const material = new THREE.MeshStandardMaterial({
        color: 0xaf52de,
        transparent: true,
        opacity: 0.5
    });

    previewMesh = new THREE.Mesh(geometry, material);
    previewMesh.position.copy(center);

    const angle = Math.atan2(direction.y, direction.x);
    previewMesh.rotation.z = angle;

    scene.add(previewMesh);
}
// Raycasting for placement
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const placementPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

function getWorldPosition(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const intersection = new THREE.Vector3();
    raycaster.ray.intersectPlane(placementPlane, intersection);

    // Clamp to playable area
    intersection.x = Math.max(-15, Math.min(15, intersection.x));
    intersection.y = Math.max(-11, Math.min(11, intersection.y));
    intersection.z = 0;

    return intersection;
}

function onMouseDown(event) {
    if (event.button !== 0) return;
    if (event.target !== renderer.domElement) return;

    const pos = getWorldPosition(event);

    // Store mouse down info for drag detection
    selectionState.mouseDownPos = pos.clone();
    selectionState.mouseDownTime = Date.now();
    selectionState.hasDragged = false;

    if (editorState.isEditorMode) {
        const tool = editorState.currentTool;

        // Select tool - try to pick an object
        if (tool === 'select') {
            const picked = pickObjectAt(pos);
            if (picked) {
                // Restore previous selection's material
                if (selectionState.selectedObject && selectionState.selectedObject !== picked) {
                    restoreObjectMaterial(selectionState.selectedObject);
                }
                selectionState.selectedObject = picked;
                selectionState.isDraggingObject = true;
                selectionState.dragOffset = new THREE.Vector3().subVectors(
                    new THREE.Vector3(picked.mesh.position.x, picked.mesh.position.y, picked.mesh.position.z),
                    pos
                );
                controls.enabled = false;
                return;
            } else {
                // Restore material when deselecting
                restoreObjectMaterial(selectionState.selectedObject);
                selectionState.selectedObject = null;
                selectionState.isDraggingObject = false;
                controls.enabled = true;
                return;
            }
        }

        // Delete tool
        if (tool === 'delete') {
            deleteObjectAt(pos);
            return;
        }

        // Drag-based tools (wall, booster)
        if (tool === 'wall' || tool === 'booster') {
            gameState.isDragging = true;
            gameState.dragStart = pos;
            controls.enabled = false;
            return;
        }

        // Click-based tools - disable controls until mouseup
        controls.enabled = false;
        return;
    }

    // Normal gameplay - ramp placement
    gameState.isDragging = true;
    gameState.dragStart = pos;
    document.getElementById('preview-info').classList.add('visible');
    controls.enabled = false;
}
function handleEditorClick(pos, event) {
    switch (editorState.currentTool) {
        case 'star':
            createStar(new THREE.Vector3(pos.x, pos.y, pos.z), gameState.starObjects.length);
            gameState.totalStars = gameState.starObjects.length;
            updateStarDisplay();
            break;
        case 'bowl':
            bowlPosition.set(pos.x, pos.y, pos.z);
            bowl.position.copy(bowlPosition);
            bowlBody.position.copy(bowlPosition);
            break;
        case 'wall':
        case 'booster':
            gameState.isDragging = true;
            gameState.dragStart = pos;
            controls.enabled = false;
            break;
        case 'spike':
            createSpike(pos);
            break;
        case 'portal':
            if (previewState.portalPlacingFirst) {
                // Place first portal (orange)
                pendingPortal = createPortal(pos, true);
                previewState.portalPlacingFirst = false;
                updateToolIndicator('portal');
                showToast('Now place the exit portal (blue)');
            } else {
                // Place second portal (blue) and link them
                const portalB = createPortal(pos, false);
                pendingPortal.linkedPortal = portalB;
                portalB.linkedPortal = pendingPortal;
                editorObjects.portals.push(pendingPortal);
                editorObjects.portals.push(portalB);
                pendingPortal = null;
                previewState.portalPlacingFirst = true;
                updateToolIndicator('portal');
            }
            break;
        case 'delete':
            deleteObjectAt(pos);
            break;
    }
    clearGhostPreview();
}

function deleteObjectAt(pos) {
    const threshold = 1.5;

    // Check stars
    for (let i = gameState.starObjects.length - 1; i >= 0; i--) {
        if (gameState.starObjects[i].mesh.position.distanceTo(pos) < threshold) {
            scene.remove(gameState.starObjects[i].mesh);
            if (gameState.starObjects[i].body) world.removeBody(gameState.starObjects[i].body);
            gameState.starObjects.splice(i, 1);
            gameState.totalStars = gameState.starObjects.length;
            updateStarDisplay();
            return;
        }
    }

    // Check walls
    for (let i = editorObjects.walls.length - 1; i >= 0; i--) {
        if (editorObjects.walls[i].mesh.position.distanceTo(pos) < threshold) {
            scene.remove(editorObjects.walls[i].mesh);
            world.removeBody(editorObjects.walls[i].body);
            editorObjects.walls.splice(i, 1);
            return;
        }
    }

    // Check boosters
    for (let i = editorObjects.boosters.length - 1; i >= 0; i--) {
        const bPos = new THREE.Vector3(editorObjects.boosters[i].position.x, editorObjects.boosters[i].position.y, editorObjects.boosters[i].position.z);
        if (bPos.distanceTo(pos) < threshold) {
            scene.remove(editorObjects.boosters[i].mesh);
            editorObjects.boosters.splice(i, 1);
            return;
        }
    }

    // Check spikes
    for (let i = editorObjects.spikes.length - 1; i >= 0; i--) {
        const sPos = new THREE.Vector3(editorObjects.spikes[i].position.x, editorObjects.spikes[i].position.y, editorObjects.spikes[i].position.z);
        if (sPos.distanceTo(pos) < threshold) {
            scene.remove(editorObjects.spikes[i].mesh);
            world.removeBody(editorObjects.spikes[i].body);
            editorObjects.spikes.splice(i, 1);
            return;
        }
    }

    // Check portals
    for (let i = editorObjects.portals.length - 1; i >= 0; i--) {
        const pPos = new THREE.Vector3(editorObjects.portals[i].position.x, editorObjects.portals[i].position.y, editorObjects.portals[i].position.z);
        if (pPos.distanceTo(pos) < threshold) {
            // Remove both portals in the pair
            const portal = editorObjects.portals[i];
            const linked = portal.linkedPortal;

            scene.remove(portal.mesh);
            editorObjects.portals.splice(i, 1);

            if (linked) {
                const linkedIndex = editorObjects.portals.indexOf(linked);
                if (linkedIndex !== -1) {
                    scene.remove(linked.mesh);
                    editorObjects.portals.splice(linkedIndex, 1);
                }
            }
            return;
        }
    }

    // Check ramps
    for (let i = gameState.placedObjects.length - 1; i >= 0; i--) {
        if (gameState.placedObjects[i].mesh.position.distanceTo(pos) < threshold) {
            scene.remove(gameState.placedObjects[i].mesh);
            world.removeBody(gameState.placedObjects[i].body);
            gameState.placedObjects.splice(i, 1);
            return;
        }
    }
}

// Handle portal placement separately
function handlePortalPlacement(pos) {
    if (previewState.portalPlacingFirst) {
        pendingPortal = createPortal(pos, true);
        previewState.portalPlacingFirst = false;
        updateToolIndicator('portal');
        showToast('Now place the exit portal (blue)');
    } else {
        const portalB = createPortal(pos, false);
        pendingPortal.linkedPortal = portalB;
        portalB.linkedPortal = pendingPortal;
        editorObjects.portals.push(pendingPortal);
        editorObjects.portals.push(portalB);
        pendingPortal = null;
        previewState.portalPlacingFirst = true;
        updateToolIndicator('portal');
    }
}

// Pick object at position for selection
// Pick object at position for selection
function pickObjectAt(pos) {
    const threshold = 1.5;
    let closest = null;
    let closestDist = threshold;

    // Check stars
    for (const star of gameState.starObjects) {
        const dist = star.mesh.position.distanceTo(pos);
        if (dist < closestDist) {
            closestDist = dist;
            closest = { type: 'star', mesh: star.mesh, data: star };
        }
    }

    // Check walls - use line segment distance
    for (const wall of editorObjects.walls) {
        if (wall.start && wall.end) {
            const dist = distanceToLineSegment(pos, wall.start, wall.end);
            if (dist < closestDist) {
                closestDist = dist;
                closest = { type: 'wall', mesh: wall.mesh, data: wall };
            }
        } else {
            const dist = wall.mesh.position.distanceTo(pos);
            if (dist < closestDist) {
                closestDist = dist;
                closest = { type: 'wall', mesh: wall.mesh, data: wall };
            }
        }
    }

    // Check boosters - use line segment distance
    for (const booster of editorObjects.boosters) {
        if (booster.start && booster.end) {
            const dist = distanceToLineSegment(pos, booster.start, booster.end);
            if (dist < closestDist) {
                closestDist = dist;
                closest = { type: 'booster', mesh: booster.mesh, data: booster };
            }
        } else {
            const dist = booster.mesh.position.distanceTo(pos);
            if (dist < closestDist) {
                closestDist = dist;
                closest = { type: 'booster', mesh: booster.mesh, data: booster };
            }
        }
    }

    // Check ramps - use length for better selection
    for (const ramp of gameState.placedObjects) {
        const rampPos = ramp.mesh.position;
        const rampLength = ramp.mesh.geometry.parameters.width || 2;
        const rampAngle = ramp.mesh.rotation.z;

        // Calculate start and end points of ramp
        const halfLength = rampLength / 2;
        const rampStart = {
            x: rampPos.x - Math.cos(rampAngle) * halfLength,
            y: rampPos.y - Math.sin(rampAngle) * halfLength,
            z: rampPos.z
        };
        const rampEnd = {
            x: rampPos.x + Math.cos(rampAngle) * halfLength,
            y: rampPos.y + Math.sin(rampAngle) * halfLength,
            z: rampPos.z
        };

        const dist = distanceToLineSegment(pos, rampStart, rampEnd);
        if (dist < closestDist) {
            closestDist = dist;
            closest = { type: 'ramp', mesh: ramp.mesh, data: ramp };
        }
    }

    // Check spikes
    for (const spike of editorObjects.spikes) {
        const spikePos = new THREE.Vector3(spike.position.x, spike.position.y, spike.position.z);
        const dist = spikePos.distanceTo(pos);
        if (dist < closestDist) {
            closestDist = dist;
            closest = { type: 'spike', mesh: spike.mesh, data: spike };
        }
    }

    // Check portals
    for (const portal of editorObjects.portals) {
        const portalPos = new THREE.Vector3(portal.position.x, portal.position.y, portal.position.z);
        const dist = portalPos.distanceTo(pos);
        if (dist < closestDist) {
            closestDist = dist;
            closest = { type: 'portal', mesh: portal.mesh, data: portal };
        }
    }

    // Check bowl (larger threshold)
    const bowlDist = bowl.position.distanceTo(pos);
    if (bowlDist < 3 && bowlDist < closestDist + 1.5) {
        closest = { type: 'bowl', mesh: bowl, data: { position: bowlPosition } };
    }

    return closest;
}

// Calculate distance from point to line segment
function distanceToLineSegment(point, lineStart, lineEnd) {
    const px = point.x;
    const py = point.y;
    const x1 = lineStart.x;
    const y1 = lineStart.y;
    const x2 = lineEnd.x;
    const y2 = lineEnd.y;

    const dx = x2 - x1;
    const dy = y2 - y1;
    const lengthSquared = dx * dx + dy * dy;

    if (lengthSquared === 0) {
        // Line segment is a point
        return Math.sqrt((px - x1) * (px - x1) + (py - y1) * (py - y1));
    }

    // Calculate projection parameter
    let t = ((px - x1) * dx + (py - y1) * dy) / lengthSquared;

    // Clamp t to [0, 1] to stay within segment
    t = Math.max(0, Math.min(1, t));

    // Find closest point on segment
    const closestX = x1 + t * dx;
    const closestY = y1 + t * dy;

    // Return distance to closest point
    return Math.sqrt((px - closestX) * (px - closestX) + (py - closestY) * (py - closestY));
}
// Update object position when dragging
function updateObjectPosition(obj, newPos) {
    if (!obj || !obj.mesh) return;

    switch (obj.type) {
        case 'star':
            obj.mesh.position.set(newPos.x, newPos.y, newPos.z);
            if (obj.data.body) {
                obj.data.body.position.set(newPos.x, newPos.y, newPos.z);
            }
            break;

        case 'wall':
        case 'booster':
            const offsetWall = new THREE.Vector3().subVectors(newPos, obj.mesh.position);
            obj.mesh.position.set(newPos.x, newPos.y, newPos.z);
            if (obj.data.body) {
                obj.data.body.position.set(newPos.x, newPos.y, newPos.z);
            }
            if (obj.data.start) {
                obj.data.start.x += offsetWall.x;
                obj.data.start.y += offsetWall.y;
                obj.data.start.z += offsetWall.z;
            }
            if (obj.data.end) {
                obj.data.end.x += offsetWall.x;
                obj.data.end.y += offsetWall.y;
                obj.data.end.z += offsetWall.z;
            }
            if (obj.data.center) {
                obj.data.center.x = newPos.x;
                obj.data.center.y = newPos.y;
                obj.data.center.z = newPos.z;
            }
            break;

        case 'ramp':
            const offsetRamp = new THREE.Vector3().subVectors(newPos, obj.mesh.position);
            obj.mesh.position.set(newPos.x, newPos.y, newPos.z);
            if (obj.data.body) {
                obj.data.body.position.set(newPos.x, newPos.y, newPos.z);
            }
            break;

        case 'spike':
            obj.mesh.position.set(newPos.x, newPos.y, newPos.z);
            obj.data.position.x = newPos.x;
            obj.data.position.y = newPos.y;
            obj.data.position.z = newPos.z;
            if (obj.data.body) {
                obj.data.body.position.set(newPos.x, newPos.y, newPos.z);
            }
            break;

        case 'portal':
            obj.mesh.position.set(newPos.x, newPos.y, newPos.z);
            obj.data.position.x = newPos.x;
            obj.data.position.y = newPos.y;
            obj.data.position.z = newPos.z;
            break;

        case 'bowl':
            bowlPosition.set(newPos.x, newPos.y, newPos.z);
            bowl.position.set(newPos.x, newPos.y, newPos.z);
            bowlBody.position.set(newPos.x, newPos.y, newPos.z);
            break;
    }
}

// Restore original material when deselecting
function restoreObjectMaterial(obj) {
    if (!obj || !obj.mesh) return;

    const mesh = obj.mesh;
    if (mesh.userData.originalMaterial) {
        mesh.material = mesh.userData.originalMaterial;
        mesh.userData.originalMaterial = null;
        mesh.userData.isHighlighted = false;
    } else if (mesh.userData.originalMaterials) {
        mesh.userData.originalMaterials.forEach((item) => {
            item.mesh.material = item.material;
        });
        mesh.userData.originalMaterials = null;
        mesh.userData.isHighlighted = false;
    }
}
let lastMoveTime = 0;
const moveThrottleMs = 16;
function onMouseMove(event) {
    const now = performance.now();
    if (now - lastMoveTime < moveThrottleMs && !gameState.isDragging && !selectionState.isDraggingObject) {
        return;
    }
    lastMoveTime = now;

    const pos = getWorldPosition(event);

    if (selectionState.mouseDownPos) {
        const dragDist = pos.distanceTo(selectionState.mouseDownPos);
        if (dragDist > 0.3) {
            selectionState.hasDragged = true;
        }
    }

    if (editorState.isEditorMode && selectionState.isDraggingObject && selectionState.selectedObject) {
        const newPos = pos.clone().add(selectionState.dragOffset);
        updateObjectPosition(selectionState.selectedObject, newPos);
        return;
    }

    if (editorState.isEditorMode && !gameState.isDragging && !selectionState.isDraggingObject) {
        const tool = editorState.currentTool;
        if (['star', 'bowl', 'spike', 'portal', 'delete'].includes(tool)) {
            if (!previewState.ghostMesh) {
                createGhostPreview(tool, pos);
            } else {
                updateGhostPreview(pos);
            }
        } else {
            clearGhostPreview();
        }
    }

    if (!gameState.isDragging) return;

    gameState.dragEnd = pos;
    updatePreview(gameState.dragStart, gameState.dragEnd);
}

function onMouseUp(event) {
    const pos = getWorldPosition(event);
    const clickDuration = Date.now() - selectionState.mouseDownTime;
    const wasQuickClick = clickDuration < 300 && !selectionState.hasDragged;

    // Handle select mode drag end
    if (selectionState.isDraggingObject) {
        selectionState.isDraggingObject = false;
        // Keep the object selected after dragging
        selectionState.mouseDownPos = null;
        controls.enabled = true;
        return;
    }

    // Handle editor click-to-place tools
    if (editorState.isEditorMode && wasQuickClick) {
        const tool = editorState.currentTool;

        if (tool === 'star') {
            createStar(new THREE.Vector3(pos.x, pos.y, pos.z), gameState.starObjects.length);
            gameState.totalStars = gameState.starObjects.length;
            updateStarDisplay();
        } else if (tool === 'bowl') {
            bowlPosition.set(pos.x, pos.y, pos.z);
            bowl.position.copy(bowlPosition);
            bowlBody.position.copy(bowlPosition);
        } else if (tool === 'spike') {
            createSpike(pos);
        } else if (tool === 'portal') {
            handlePortalPlacement(pos);
        }

        clearGhostPreview();
    }

    // Handle drag-based placements (only if we actually dragged)
    if (gameState.isDragging && gameState.dragStart && gameState.dragEnd && selectionState.hasDragged) {
        if (editorState.isEditorMode) {
            if (editorState.currentTool === 'wall') {
                createWall(gameState.dragStart, gameState.dragEnd);
            } else if (editorState.currentTool === 'booster') {
                createBooster(gameState.dragStart, gameState.dragEnd);
            }
        } else {
            createRamp(gameState.dragStart, gameState.dragEnd, gameState.currentTool);
        }
    }

    // Reset states
    gameState.isDragging = false;
    gameState.dragStart = null;
    gameState.dragEnd = null;
    selectionState.mouseDownPos = null;
    document.getElementById('preview-info').classList.remove('visible');
    controls.enabled = true;

    if (previewMesh) {
        scene.remove(previewMesh);
        previewMesh = null;
    }
}
document.getElementById('btn-play').addEventListener('click', () => {
    if (!gameState.isPlaying) {
        gameState.isPlaying = true;
        isFollowing = true;
        isTransitioningToFollow = true;
        orbitAngle = Math.atan2(camera.position.x - ball.position.x, camera.position.z - ball.position.z);
        ballBody.type = CANNON.Body.DYNAMIC;
        ballBody.wakeUp();
        controls.enabled = false;
    }
});

document.getElementById('btn-reset').addEventListener('click', resetBall);
document.getElementById('btn-clear').addEventListener('click', clearAllRamps);
document.getElementById('btn-camera').addEventListener('click', resetCamera);
document.getElementById('btn-next').addEventListener('click', nextLevel);
function resetBall() {
    // If testing, stop test mode instead of just resetting
    if (testModeState.isTesting) {
        stopTesting();
        return;
    }
    gameState.isPlaying = false;
    isOrbiting = false;
    groundContactTime = 0;

    ballBody.type = CANNON.Body.STATIC;
    ballBody.position.copy(ballStartPosition);
    ballBody.velocity.set(0, 0, 0);
    ballBody.angularVelocity.set(0, 0, 0);
    ball.position.copy(ballStartPosition);
    ball.rotation.set(0, 0, 0);
    clearTrail();

    // Clear any remaining burst particles
    for (let i = burstParticles.length - 1; i >= 0; i--) {
        const particle = burstParticles[i];
        scene.remove(particle);
        particle.geometry.dispose();
        particle.material.dispose();
    }
    burstParticles.length = 0;

    // Clear confetti
    for (let i = confettiParticles.length - 1; i >= 0; i--) {
        const particle = confettiParticles[i];
        scene.remove(particle);
        particle.geometry.dispose();
        particle.material.dispose();
    }
    confettiParticles.length = 0;

    cameraLookTarget = null;
    cameraTargetPos = null;

    // Reset stars
    gameState.stars = 0;
    updateStarDisplay();
    gameState.starObjects.forEach(obj => {
        obj.collected = false;
        obj.mesh.visible = true;
    });

    // Ease camera back to original position
    easeCameraToStart();
    controls.enabled = true;
    directionalLight.shadow.needsUpdate = true;

}

function easeCameraToStart() {
    isFollowing = false;
    isTransitioningToFollow = false;

    const startPos = camera.position.clone();
    const startTarget = controls.target.clone();
    const endPos = new THREE.Vector3(0, 15, 25);
    const endTarget = new THREE.Vector3(0, 0, 0);
    const duration = 1200;
    const startTime = Date.now();

    function animateCamera() {
        const elapsed = Date.now() - startTime;
        const t = Math.min(elapsed / duration, 1);
        // Ease out cubic
        const ease = 1 - Math.pow(1 - t, 3);

        camera.position.lerpVectors(startPos, endPos, ease);
        controls.target.lerpVectors(startTarget, endTarget, ease);

        if (t < 1) {
            requestAnimationFrame(animateCamera);
        }
    }
    animateCamera();
}

function updateFollowCamera(delta) {
    if (!isFollowing || !gameState.isPlaying) return;

    // Use physics body position directly to avoid jitter
    const ballPos = new THREE.Vector3(
        ballBody.position.x,
        ballBody.position.y,
        ballBody.position.z
    );

    // Initialize targets on first frame
    if (!cameraLookTarget) {
        cameraLookTarget = new THREE.Vector3(0, 0, 0);
        cameraTargetPos = camera.position.clone();
    }

    // Orbit around the ball horizontally only
    orbitAngle += orbitSpeed * delta;

    // Calculate ideal camera position - same Y as ball, orbiting on X/Z
    const idealPos = new THREE.Vector3(
        ballPos.x + Math.sin(orbitAngle) * followDistance,
        ballPos.y,
        ballPos.z + Math.cos(orbitAngle) * followDistance
    );

    // Ease the target position (first layer of smoothing)
    cameraTargetPos.x += 0.08 * (idealPos.x - cameraTargetPos.x);
    cameraTargetPos.y += 0.08 * (idealPos.y - cameraTargetPos.y);
    cameraTargetPos.z += 0.08 * (idealPos.z - cameraTargetPos.z);

    // Ease the actual camera to the target (second layer of smoothing)
    camera.position.x += 0.04 * (cameraTargetPos.x - camera.position.x);
    camera.position.y += 0.04 * (cameraTargetPos.y - camera.position.y);
    camera.position.z += 0.04 * (cameraTargetPos.z - camera.position.z);

    // Ease the look target
    cameraLookTarget.x += 0.04 * (ballPos.x - cameraLookTarget.x);
    cameraLookTarget.y += 0.04 * (ballPos.y - cameraLookTarget.y);
    cameraLookTarget.z += 0.04 * (ballPos.z - cameraLookTarget.z);

    camera.lookAt(cameraLookTarget);

    // Check if initial transition is done
    if (isTransitioningToFollow && camera.position.distanceTo(idealPos) < 1) {
        isTransitioningToFollow = false;
    }
}

function clearAllRamps() {
    gameState.placedObjects.forEach(obj => {
        scene.remove(obj.mesh);
        world.removeBody(obj.body);
    });
    gameState.placedObjects = [];
}

function resetCamera() {
    camera.position.set(0, 0, 25);
    controls.target.set(0, 0, 0);
    controls.update();
}

async function nextLevel() {
    document.getElementById('win-modal').classList.remove('active');
    gameState.level++;

    // Check if there's a next level
    if (gameState.level > menuState.levels.length) {
        // No more levels, return to menu
        showToast('🎉 You completed all levels!');
        setTimeout(showMenu, 1000);
        return;
    }

    const levelData = menuState.levels[gameState.level - 1];
    if (levelData) {
        loadLevelFromCode(levelData.code);
        document.getElementById('level-display').textContent = `Level ${gameState.level}`;
    } else {
        showMenu();
    }

    resetBall();
}

function updateStarDisplay() {
    domCache.starCount.textContent = `${gameState.stars} / ${gameState.totalStars}`;
}

function showStarCollectAnimation(position) {
    // Create burst particles in 3D
    const particleCount = 5;
    const colors = [0xffcc00, 0xff9500, 0xffdd44, 0xffaa00];

    for (let i = 0; i < particleCount; i++) {
        // Create star-shaped particle
        const starShape = new THREE.Shape();
        const outerRadius = 0.15 + Math.random() * 0.1;
        const innerRadius = outerRadius * 0.4;
        const spikes = 5;

        for (let j = 0; j < spikes * 2; j++) {
            const radius = j % 2 === 0 ? outerRadius : innerRadius;
            const angle = (j / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
            const x = Math.cos(angle) * radius;
            const y = Math.sin(angle) * radius;
            if (j === 0) starShape.moveTo(x, y);
            else starShape.lineTo(x, y);
        }
        starShape.closePath();

        const geometry = new THREE.ExtrudeGeometry(starShape, {
            depth: 0.05,
            bevelEnabled: false
        });

        const material = new THREE.MeshStandardMaterial({
            color: colors[Math.floor(Math.random() * colors.length)],
            emissive: 0xff9500,
            emissiveIntensity: 0.5,
            metalness: 0.8,
            roughness: 0.2
        });

        const particle = new THREE.Mesh(geometry, material);
        particle.position.copy(position);

        // Random explosion direction
        const angle = (i / particleCount) * Math.PI * 2;
        const upwardBias = 0.5 + Math.random() * 0.5;
        const speed = 8 + Math.random() * 6;

        particle.userData.velocity = new THREE.Vector3(
            Math.cos(angle) * speed * (0.5 + Math.random() * 0.5),
            upwardBias * speed,
            Math.sin(angle) * speed * (0.5 + Math.random() * 0.5)
        );
        particle.userData.rotationSpeed = new THREE.Vector3(
            (Math.random() - 0.5) * 15,
            (Math.random() - 0.5) * 15,
            (Math.random() - 0.5) * 15
        );
        particle.userData.gravity = -25;
        particle.userData.life = 1.0;
        particle.userData.scale = 0.8 + Math.random() * 0.4;

        scene.add(particle);
        burstParticles.push(particle);
    }

    // Add sparkle particles (smaller, faster fade)
    for (let i = 0; i < 10; i++) {
        const sparkGeometry = new THREE.SphereGeometry(0.05 + Math.random() * 0.05, 8, 8);
        const sparkMaterial = new THREE.MeshBasicMaterial({
            color: 0xffffcc,
            transparent: true,
            opacity: 1
        });

        const spark = new THREE.Mesh(sparkGeometry, sparkMaterial);
        spark.position.copy(position);

        const angle = Math.random() * Math.PI * 2;
        const elevation = Math.random() * Math.PI - Math.PI / 2;
        const speed = 5 + Math.random() * 10;

        spark.userData.velocity = new THREE.Vector3(
            Math.cos(angle) * Math.cos(elevation) * speed,
            Math.sin(elevation) * speed + 3,
            Math.sin(angle) * Math.cos(elevation) * speed
        );
        spark.userData.gravity = -15;
        spark.userData.life = 1.0;
        spark.userData.fadeSpeed = 2 + Math.random();
        spark.userData.isSpark = true;

        scene.add(spark);
        burstParticles.push(spark);
    }

    // Flash effect at collection point
    const flashGeometry = new THREE.SphereGeometry(0.5, 16, 16);
    const flashMaterial = new THREE.MeshBasicMaterial({
        color: 0xffff99,
        transparent: true,
        opacity: 1
    });
    const flash = new THREE.Mesh(flashGeometry, flashMaterial);
    flash.position.copy(position);
    flash.userData.isFlash = true;
    flash.userData.life = 1.0;
    scene.add(flash);
    burstParticles.push(flash);

    // Play layered sound effect
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

        // Main chime
        const osc1 = audioCtx.createOscillator();
        const gain1 = audioCtx.createGain();
        osc1.connect(gain1);
        gain1.connect(audioCtx.destination);
        osc1.frequency.value = 880;
        osc1.type = 'sine';
        gain1.gain.setValueAtTime(0.3, audioCtx.currentTime);
        gain1.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
        osc1.start(audioCtx.currentTime);
        osc1.stop(audioCtx.currentTime + 0.3);

        // Shimmer
        const osc2 = audioCtx.createOscillator();
        const gain2 = audioCtx.createGain();
        osc2.connect(gain2);
        gain2.connect(audioCtx.destination);
        osc2.frequency.value = 1320;
        osc2.type = 'sine';
        gain2.gain.setValueAtTime(0.15, audioCtx.currentTime);
        gain2.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.2);
        osc2.start(audioCtx.currentTime + 0.05);
        osc2.stop(audioCtx.currentTime + 0.25);

        // Pop
        const osc3 = audioCtx.createOscillator();
        const gain3 = audioCtx.createGain();
        osc3.connect(gain3);
        gain3.connect(audioCtx.destination);
        osc3.frequency.setValueAtTime(600, audioCtx.currentTime);
        osc3.frequency.exponentialRampToValueAtTime(100, audioCtx.currentTime + 0.1);
        osc3.type = 'sine';
        gain3.gain.setValueAtTime(0.2, audioCtx.currentTime);
        gain3.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
        osc3.start(audioCtx.currentTime);
        osc3.stop(audioCtx.currentTime + 0.1);
    } catch (e) { }
}

function updateBurstParticles(delta) {
    for (let i = burstParticles.length - 1; i >= 0; i--) {
        const particle = burstParticles[i];

        if (particle.userData.isFlash) {
            // Flash expands and fades quickly
            particle.userData.life -= delta * 5;
            particle.scale.setScalar(1 + (1 - particle.userData.life) * 3);
            particle.material.opacity = particle.userData.life;

            if (particle.userData.life <= 0) {
                scene.remove(particle);
                particle.geometry.dispose();
                particle.material.dispose();
                burstParticles.splice(i, 1);
            }
            continue;
        }

        if (particle.userData.isSpark) {
            // Sparks fade faster
            particle.userData.life -= delta * particle.userData.fadeSpeed;
            particle.material.opacity = particle.userData.life;
        } else {
            // Star particles fade slower
            particle.userData.life -= delta * 0.8;
        }

        // Apply velocity
        particle.position.x += particle.userData.velocity.x * delta;
        particle.position.y += particle.userData.velocity.y * delta;
        particle.position.z += particle.userData.velocity.z * delta;

        // Apply gravity
        particle.userData.velocity.y += particle.userData.gravity * delta;

        // Rotate star particles
        if (particle.userData.rotationSpeed) {
            particle.rotation.x += particle.userData.rotationSpeed.x * delta;
            particle.rotation.y += particle.userData.rotationSpeed.y * delta;
            particle.rotation.z += particle.userData.rotationSpeed.z * delta;
        }

        // Remove dead particles or those that fell off screen
        if (particle.userData.life <= 0 || particle.position.y < -20) {
            scene.remove(particle);
            particle.geometry.dispose();
            particle.material.dispose();
            burstParticles.splice(i, 1);
        }
    }
}

function spawnLandingDust(position, intensity) {
    // More particles for bigger impacts
    const particleCount = Math.floor(1 + intensity * 15);

    // Dust cloud colors - warm grays and tans
    const dustColors = [0xd4cfc4, 0xccc5b9, 0xb8b0a0, 0xe0d8cc];

    // Main dust puffs - 3D lit particles
    for (let i = 0; i < particleCount; i++) {
        const size = 0.12 + Math.random() * 0.2 * intensity;
        const geometry = new THREE.SphereGeometry(size, 12, 12);
        const material = new THREE.MeshStandardMaterial({
            color: dustColors[Math.floor(Math.random() * dustColors.length)],
            transparent: true,
            opacity: 0.6 + Math.random() * 0.3,
            roughness: 1.0,
            metalness: 0.0
        });

        const particle = new THREE.Mesh(geometry, material);

        // Spawn in a 3D sphere around impact point
        const spawnRadius = 0.2 + Math.random() * 0.5;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.random() * Math.PI * 0.5; // Hemisphere (upward)
        particle.position.set(
            position.x + Math.cos(theta) * Math.sin(phi) * spawnRadius,
            position.y - 0.2 + Math.cos(phi) * spawnRadius * 0.3,
            position.z + Math.sin(theta) * Math.sin(phi) * spawnRadius
        );

        // Radial outward velocity in 3D
        const angle = Math.random() * Math.PI * 2;
        const elevation = Math.random() * 0.5; // Slight upward bias
        const speed = (2 + Math.random() * 4) * intensity;

        particle.userData.velocity = new THREE.Vector3(
            Math.cos(angle) * speed * (0.8 + Math.random() * 0.4),
            (0.5 + elevation + Math.random() * 2) * intensity,
            Math.sin(angle) * speed * (0.8 + Math.random() * 0.4)
        );
        particle.userData.life = 1.0;
        particle.userData.fadeSpeed = 0.6 + Math.random() * 0.5;
        particle.userData.growthRate = 2 + Math.random() * 2.5;
        particle.userData.initialScale = 0.4 + Math.random() * 0.6;
        particle.userData.rotationSpeed = new THREE.Vector3(
            (Math.random() - 0.5) * 3,
            (Math.random() - 0.5) * 3,
            (Math.random() - 0.5) * 3
        );
        particle.scale.setScalar(particle.userData.initialScale);
        particle.castShadow = true;

        scene.add(particle);
        dustParticles.push(particle);
    }

    // Add chunky debris that tumbles
    const debrisCount = Math.floor(4 + intensity * 6);
    for (let i = 0; i < debrisCount; i++) {
        // Use irregular shapes - boxes and tetrahedrons
        let geometry;
        if (Math.random() > 0.5) {
            const s = 0.05 + Math.random() * 0.08;
            geometry = new THREE.BoxGeometry(s, s * (0.5 + Math.random()), s * (0.5 + Math.random()));
        } else {
            geometry = new THREE.TetrahedronGeometry(0.04 + Math.random() * 0.06);
        }

        const material = new THREE.MeshStandardMaterial({
            color: 0x8a8070,
            transparent: true,
            opacity: 0.9,
            roughness: 0.9,
            metalness: 0.1
        });

        const debris = new THREE.Mesh(geometry, material);
        debris.position.set(
            position.x + (Math.random() - 0.5) * 0.4,
            position.y - 0.1,
            position.z + (Math.random() - 0.5) * 0.4
        );

        // Random initial rotation
        debris.rotation.set(
            Math.random() * Math.PI * 2,
            Math.random() * Math.PI * 2,
            Math.random() * Math.PI * 2
        );

        const angle = Math.random() * Math.PI * 2;
        const speed = (4 + Math.random() * 6) * intensity;
        debris.userData.velocity = new THREE.Vector3(
            Math.cos(angle) * speed,
            3 + Math.random() * 5 * intensity,
            Math.sin(angle) * speed
        );
        debris.userData.rotationSpeed = new THREE.Vector3(
            (Math.random() - 0.5) * 15,
            (Math.random() - 0.5) * 15,
            (Math.random() - 0.5) * 15
        );
        debris.userData.life = 1.0;
        debris.userData.fadeSpeed = 1.5 + Math.random();
        debris.userData.isDebris = true;
        debris.userData.gravity = -25 - Math.random() * 10;
        debris.castShadow = true;

        scene.add(debris);
        dustParticles.push(debris);
    }

    // Ground impact ring (keep this 2D, it's meant to be flat)
    const ringGeometry = new THREE.RingGeometry(0.1, 0.25, 32);
    const ringMaterial = new THREE.MeshBasicMaterial({
        color: 0xc4beb3,
        transparent: true,
        opacity: 0.35 * intensity,
        side: THREE.DoubleSide
    });
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.position.set(position.x, position.y - 0.48, position.z);
    ring.rotation.x = -Math.PI / 2;
    ring.userData.isRing = true;
    ring.userData.life = 1.0;
    ring.userData.expandSpeed = 5 + intensity * 4;
    scene.add(ring);
    dustParticles.push(ring);
}
function updateDustParticles(delta) {
    for (let i = dustParticles.length - 1; i >= 0; i--) {
        const particle = dustParticles[i];

        // Handle expanding ring
        if (particle.userData.isRing) {
            particle.userData.life -= delta * 2;
            particle.material.opacity = particle.userData.life * 0.35;

            const expandAmount = particle.userData.expandSpeed * delta;
            particle.scale.x += expandAmount;
            particle.scale.y += expandAmount;

            if (particle.userData.life <= 0) {
                scene.remove(particle);
                particle.geometry.dispose();
                particle.material.dispose();
                dustParticles.splice(i, 1);
            }
            continue;
        }

        // Handle tumbling debris
        if (particle.userData.isDebris) {
            particle.userData.life -= delta * particle.userData.fadeSpeed;
            particle.material.opacity = Math.max(0, particle.userData.life * 0.9);

            // Move
            particle.position.x += particle.userData.velocity.x * delta;
            particle.position.y += particle.userData.velocity.y * delta;
            particle.position.z += particle.userData.velocity.z * delta;

            // Tumble rotation
            particle.rotation.x += particle.userData.rotationSpeed.x * delta;
            particle.rotation.y += particle.userData.rotationSpeed.y * delta;
            particle.rotation.z += particle.userData.rotationSpeed.z * delta;

            // Gravity and drag
            particle.userData.velocity.y += particle.userData.gravity * delta;
            particle.userData.velocity.x *= 0.99;
            particle.userData.velocity.z *= 0.99;

            // Slow rotation over time
            particle.userData.rotationSpeed.multiplyScalar(0.995);

            if (particle.userData.life <= 0 || particle.position.y < -15) {
                scene.remove(particle);
                particle.geometry.dispose();
                particle.material.dispose();
                dustParticles.splice(i, 1);
            }
            continue;
        }

        // Regular dust puffs
        particle.userData.life -= delta * particle.userData.fadeSpeed;
        particle.material.opacity = Math.max(0, particle.userData.life * 0.7);

        // Expand as it fades (cloud-like behavior)
        if (particle.userData.growthRate) {
            const growth = 1 + (1 - particle.userData.life) * particle.userData.growthRate;
            particle.scale.setScalar(particle.userData.initialScale * growth);
        }

        // Apply velocity
        particle.position.x += particle.userData.velocity.x * delta;
        particle.position.y += particle.userData.velocity.y * delta;
        particle.position.z += particle.userData.velocity.z * delta;

        // Rotate for more 3D feel
        if (particle.userData.rotationSpeed) {
            particle.rotation.x += particle.userData.rotationSpeed.x * delta;
            particle.rotation.y += particle.userData.rotationSpeed.y * delta;
            particle.rotation.z += particle.userData.rotationSpeed.z * delta;
        }

        // Heavy drag - dust floats and settles
        particle.userData.velocity.multiplyScalar(0.94);
        particle.userData.velocity.y -= 3 * delta;

        if (particle.userData.life <= 0) {
            scene.remove(particle);
            particle.geometry.dispose();
            particle.material.dispose();
            dustParticles.splice(i, 1);
        }
    }
}
function spawnConfetti() {
    const colors = [0xff2d55, 0xff9500, 0xffcc00, 0x34c759, 0x007aff, 0xaf52de];
    const particleCount = 80;

    for (let i = 0; i < particleCount; i++) {
        // Random confetti shape (rectangle)
        const width = 0.15 + Math.random() * 0.15;
        const height = 0.3 + Math.random() * 0.2;
        const geometry = new THREE.PlaneGeometry(width, height);
        const material = new THREE.MeshBasicMaterial({
            color: colors[Math.floor(Math.random() * colors.length)],
            transparent: true,
            opacity: 1,
            side: THREE.DoubleSide
        });

        const particle = new THREE.Mesh(geometry, material);

        // Start from bowl area, spread upward
        particle.position.set(
            bowlPosition.x + (Math.random() - 0.5) * 4,
            bowlPosition.y + 2,
            bowlPosition.z + (Math.random() - 0.5) * 4
        );

        // Explosion velocity
        const angle = Math.random() * Math.PI * 2;
        const upward = 8 + Math.random() * 12;
        const outward = 3 + Math.random() * 5;

        particle.userData.velocity = new THREE.Vector3(
            Math.cos(angle) * outward,
            upward,
            Math.sin(angle) * outward
        );
        particle.userData.rotationSpeed = new THREE.Vector3(
            (Math.random() - 0.5) * 10,
            (Math.random() - 0.5) * 10,
            (Math.random() - 0.5) * 10
        );
        particle.userData.life = 1.0;
        particle.userData.flutter = Math.random() * Math.PI * 2; // phase offset for flutter

        scene.add(particle);
        confettiParticles.push(particle);
    }

    // Play celebration sound
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

        // Fanfare-like sound
        [523, 659, 784].forEach((freq, i) => {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.frequency.value = freq;
            osc.type = 'triangle';
            gain.gain.setValueAtTime(0.2, audioCtx.currentTime + i * 0.1);
            gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + i * 0.1 + 0.4);
            osc.start(audioCtx.currentTime + i * 0.1);
            osc.stop(audioCtx.currentTime + i * 0.1 + 0.4);
        });
    } catch (e) { }
}

function updateConfetti(delta) {
    for (let i = confettiParticles.length - 1; i >= 0; i--) {
        const particle = confettiParticles[i];

        // Flutter effect
        particle.userData.flutter += delta * 5;
        const flutter = Math.sin(particle.userData.flutter) * 2;

        // Apply velocity
        particle.position.x += (particle.userData.velocity.x + flutter * 0.3) * delta;
        particle.position.y += particle.userData.velocity.y * delta;
        particle.position.z += particle.userData.velocity.z * delta;

        // Gravity and air resistance
        particle.userData.velocity.y -= 15 * delta;
        particle.userData.velocity.x *= 0.99;
        particle.userData.velocity.z *= 0.99;

        // Tumbling rotation
        particle.rotation.x += particle.userData.rotationSpeed.x * delta;
        particle.rotation.y += particle.userData.rotationSpeed.y * delta;
        particle.rotation.z += particle.userData.rotationSpeed.z * delta;

        // Fade after a while
        if (particle.position.y < bowlPosition.y - 2) {
            particle.userData.life -= delta * 2;
            particle.material.opacity = particle.userData.life;
        }

        // Remove when dead or fallen too far
        if (particle.userData.life <= 0 || particle.position.y < -20) {
            scene.remove(particle);
            particle.geometry.dispose();
            particle.material.dispose();
            confettiParticles.splice(i, 1);
        }
    }
}
function showWinModal() {
    completeLevel(gameState.level);
    spawnConfetti();

    setTimeout(() => {
        domCache.winModal.classList.add('active');
    }, 300);
}

// Check collisions
function checkCollisions() {
    if (!gameState.isPlaying) return;

    const ballX = ballBody.position.x;
    const ballY = ballBody.position.y;
    const ballZ = ballBody.position.z;

    // Check star collisions using squared distance
    for (let i = 0; i < gameState.starObjects.length; i++) {
        const star = gameState.starObjects[i];
        if (star.collected) continue;

        const pos = star.mesh.position;
        const dx = ballX - pos.x;
        const dy = ballY - pos.y;
        const dz = ballZ - pos.z;
        const distSq = dx * dx + dy * dy + dz * dz;

        if (distSq < 1) {
            star.collected = true;
            star.mesh.visible = false;
            gameState.stars++;
            updateStarDisplay();
            showStarCollectAnimation(pos);
        }
    }

    // Check booster collisions
    for (let i = 0; i < editorObjects.boosters.length; i++) {
        const booster = editorObjects.boosters[i];
        const dx = ballX - booster.center.x;
        const dy = ballY - booster.center.y;
        const dz = ballZ - booster.center.z;
        const distSq = dx * dx + dy * dy + dz * dz;
        const threshold = booster.length / 2 + 0.5;

        if (distSq < threshold * threshold) {
            const heightDiff = Math.abs(dy);
            if (heightDiff < 1) {
                const boostAmount = 0.5;
                ballBody.velocity.x += booster.direction.x * boostAmount;
                ballBody.velocity.y += booster.direction.y * boostAmount;
            }
        }
    }

    // Check portal collisions
    for (let i = 0; i < editorObjects.portals.length; i++) {
        const portal = editorObjects.portals[i];
        if (!portal.linkedPortal) continue;

        const dx = ballX - portal.position.x;
        const dy = ballY - portal.position.y;
        const dz = ballZ - portal.position.z;
        const distSq = dx * dx + dy * dy + dz * dz;

        if (distSq < 0.64 && !portal.justExited) {
            const exitPos = portal.linkedPortal.position;
            ballBody.position.set(exitPos.x, exitPos.y, exitPos.z);

            portal.linkedPortal.justExited = true;
            setTimeout(() => {
                portal.linkedPortal.justExited = false;
            }, 500);

            try {
                const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                const oscillator = audioCtx.createOscillator();
                const gainNode = audioCtx.createGain();
                oscillator.connect(gainNode);
                gainNode.connect(audioCtx.destination);
                oscillator.frequency.setValueAtTime(440, audioCtx.currentTime);
                oscillator.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.1);
                oscillator.type = 'sine';
                gainNode.gain.setValueAtTime(0.3, audioCtx.currentTime);
                gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.2);
                oscillator.start(audioCtx.currentTime);
                oscillator.stop(audioCtx.currentTime + 0.2);
            } catch (e) { }
        }
    }

    // Check spike collisions
    for (let i = 0; i < editorObjects.spikes.length; i++) {
        const spike = editorObjects.spikes[i];
        const dx = ballX - spike.position.x;
        const dy = ballY - spike.position.y;
        const dz = ballZ - spike.position.z;
        const distSq = dx * dx + dy * dy + dz * dz;

        if (distSq < 0.64) {
            resetBall();
            return;
        }
    }

    // Check bowl collision
    const bowlDx = ballX - bowlPosition.x;
    const bowlDy = ballY - bowlPosition.y;
    const bowlDz = ballZ - bowlPosition.z;
    const bowlDistSq = bowlDx * bowlDx + bowlDy * bowlDy + bowlDz * bowlDz;

    if (bowlDistSq < 4 && ballY < bowlPosition.y + 1) {
        gameState.isPlaying = false;
        setTimeout(showWinModal, 500);
    }

    // Check if ball fell below ground
    if (ballY < -15) {
        resetBall();
    }
}
function checkGroundContact(delta) {
    if (!gameState.isPlaying) return;

    const ballY = ballBody.position.y;
    const ballVelY = Math.abs(ballBody.velocity.y);

    // Ball is on ground if it's low and barely moving vertically
    if (ballY < -10.5 && ballVelY < 0.5) {
        groundContactTime += delta * 1000;
        if (groundContactTime >= groundResetDelay) {
            resetBall();
        }
    } else {
        groundContactTime = 0;
    }
}

// Animation loop
const clock = new THREE.Clock();

function animate() {
    requestAnimationFrame(animate);

    const delta = Math.min(clock.getDelta(), 0.1);

    // Update physics with actual frame time
    world.step(delta);

    if (ball && ballBody) {
        ball.position.set(ballBody.position.x, ballBody.position.y, ballBody.position.z);
        ball.quaternion.set(ballBody.quaternion.x, ballBody.quaternion.y, ballBody.quaternion.z, ballBody.quaternion.w);

        // Landing dust (without squash)
        const velY = ballBody.velocity.y;
        const justLanded = lastBallVelocityY < -5 && velY > lastBallVelocityY + 3;
        if (justLanded) {
            const intensity = Math.min(1, Math.abs(lastBallVelocityY) / 15);
            if (intensity > 0.3) {
                spawnLandingDust(ball.position, intensity);
            }
        }
        lastBallVelocityY = velY;
        // Update ball trail
        // updateTrail();
        // Update burst particles
        updateBurstParticles(delta);
        updateDustParticles(delta);
        updateConfetti(delta);
    }

    // Animate stars - cached time values
    const animTime = Date.now();
    const timeFast = animTime * 0.003;
    const timeSlow = animTime * 0.005;

    for (let i = 0; i < gameState.starObjects.length; i++) {
        const star = gameState.starObjects[i];
        if (star.collected) continue;

        star.mesh.rotation.y += 0.02;
        star.mesh.position.y += Math.sin(timeFast + i) * 0.002;

        const pulse = 0.4 + Math.sin(timeSlow + i * 0.5) * 0.2;
        const light = star.mesh.userData.light;
        const glow = star.mesh.userData.glow;

        if (light) {
            light.intensity = 1.5 + pulse;
        }
        if (glow) {
            glow.material.opacity = 0.4 + pulse * 0.4;
            const glowScale = 2.5 + pulse;
            glow.scale.set(glowScale, glowScale, 1);
        }
    }

    // Animate portals
    editorObjects.portals.forEach((portal) => {
        portal.mesh.rotation.z += 0.02;
    });

    // Highlight selected object (yellow tint)
    if (editorState.isEditorMode && selectionState.selectedObject && selectionState.selectedObject.mesh) {
        const mesh = selectionState.selectedObject.mesh;

        // Store original material if not stored
        if (!mesh.userData.originalMaterial) {
            if (mesh.material) {
                mesh.userData.originalMaterial = mesh.material.clone();
            } else if (mesh.children) {
                mesh.userData.originalMaterials = [];
                mesh.traverse((child) => {
                    if (child.isMesh && child.material) {
                        mesh.userData.originalMaterials.push({ mesh: child, material: child.material.clone() });
                    }
                });
            }
            mesh.userData.isHighlighted = false;
        }

        // Apply yellow highlight
        if (!mesh.userData.isHighlighted) {
            if (mesh.material) {
                mesh.material = new THREE.MeshStandardMaterial({
                    color: 0xffdd00,
                    emissive: 0xffdd00,
                    emissiveIntensity: 0.3,
                    roughness: 0.3,
                    metalness: 0.5
                });
            } else if (mesh.children) {
                mesh.traverse((child) => {
                    if (child.isMesh) {
                        child.material = new THREE.MeshStandardMaterial({
                            color: 0xffdd00,
                            emissive: 0xffdd00,
                            emissiveIntensity: 0.3,
                            roughness: 0.3,
                            metalness: 0.5
                        });
                    }
                });
            }
            mesh.userData.isHighlighted = true;
        }
    }
    // Check collisions
    checkCollisions();

    // Check for ground contact timeout
    checkGroundContact(delta);

    // Follow camera when playing
    updateFollowCamera(delta);

    if (!isFollowing) {
        controls.update();
    }

    renderer.render(scene, camera);
}
// Handle resize
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// Mouse events
renderer.domElement.addEventListener('mousedown', onMouseDown);
window.addEventListener('mousemove', onMouseMove);
window.addEventListener('mouseup', onMouseUp);

// Touch events
renderer.domElement.addEventListener('touchstart', (e) => {
    e.preventDefault();
    onMouseDown({ button: 0, target: renderer.domElement, clientX: e.touches[0].clientX, clientY: e.touches[0].clientY });
}, { passive: false });

window.addEventListener('touchmove', (e) => {
    onMouseMove({ clientX: e.touches[0].clientX, clientY: e.touches[0].clientY });
});

window.addEventListener('touchend', onMouseUp);

// Editor toggle
document.getElementById('btn-editor').addEventListener('click', () => {
    editorState.isEditorMode = !editorState.isEditorMode;
    document.getElementById('editor-toolbar').style.display = editorState.isEditorMode ? 'flex' : 'none';
    document.getElementById('btn-editor').classList.toggle('active', editorState.isEditorMode);

    // Reset selection state
    selectionState.selectedObject = null;
    selectionState.isDraggingObject = false;

    if (editorState.isEditorMode) {
        editorState.currentTool = 'select';
        document.querySelectorAll('[data-editor-tool]').forEach(b => b.classList.remove('active'));
        document.querySelector('[data-editor-tool="select"]').classList.add('active');
        document.querySelector('.instructions').innerHTML =
            '<strong>Editor Mode:</strong> Select & drag objects, or choose a tool to place';
        updateToolIndicator(editorState.currentTool);
    } else {
        document.querySelector('.instructions').innerHTML =
            '<strong>Click and drag</strong> to place ramps • <strong>Scroll</strong> to zoom • <strong>Right-drag</strong> to rotate view';
        clearGhostPreview();
        document.getElementById('tool-indicator').classList.remove('visible');
    }
});

// Editor tool selection
document.querySelectorAll('[data-editor-tool]').forEach(btn => {
    btn.addEventListener('click', () => {
        const newTool = btn.dataset.editorTool;

        document.querySelectorAll('[data-editor-tool]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        editorState.currentTool = newTool;

        // Restore material of previously selected object
        restoreObjectMaterial(selectionState.selectedObject);

        // Clear selection when switching tools
        selectionState.selectedObject = null;
        selectionState.isDraggingObject = false;

        // Reset portal placement state when switching tools
        if (newTool !== 'portal') {
            previewState.portalPlacingFirst = true;
            if (pendingPortal) {
                scene.remove(pendingPortal.mesh);
                pendingPortal = null;
            }
        }

        clearGhostPreview();
        updateToolIndicator(editorState.currentTool);
    });
});

// Export button
document.getElementById('btn-export').addEventListener('click', () => {
    const code = generateLevelCode();
    document.getElementById('level-code').value = code;
    document.getElementById('code-modal-title').textContent = 'Export Level Code';
    document.getElementById('btn-code-confirm').textContent = 'Copy & Close';
    document.getElementById('code-modal').classList.add('active');
});

// Import button
document.getElementById('btn-import').addEventListener('click', () => {
    document.getElementById('level-code').value = '';
    document.getElementById('code-modal-title').textContent = 'Import Level Code';
    document.getElementById('btn-code-confirm').textContent = 'Load Level';
    document.getElementById('code-modal').classList.add('active');
});

// Code modal buttons
document.getElementById('btn-code-cancel').addEventListener('click', () => {
    document.getElementById('code-modal').classList.remove('active');
});

document.getElementById('btn-code-confirm').addEventListener('click', () => {
    const code = document.getElementById('level-code').value;
    const isExport = document.getElementById('code-modal-title').textContent === 'Export Level Code';

    if (isExport) {
        navigator.clipboard.writeText(code).catch(() => { });
    } else if (code.trim()) {
        loadLevelFromCode(code);
    }
    document.getElementById('code-modal').classList.remove('active');
});

// Back to menu button
document.getElementById('btn-menu').addEventListener('click', () => {
    resetBall();
    showMenu();
});

// Editor mode from menu
document.getElementById('btn-editor-mode').addEventListener('click', () => {
    document.getElementById('menu-overlay').classList.add('hidden');
    editorState.isEditorMode = true;
    editorState.currentTool = 'select';
    document.getElementById('editor-toolbar').style.display = 'flex';
    document.getElementById('btn-editor').classList.add('active');

    // Set select tool as active
    document.querySelectorAll('[data-editor-tool]').forEach(b => b.classList.remove('active'));
    document.querySelector('[data-editor-tool="select"]').classList.add('active');

    // Clear everything for blank level
    clearLevel();

    // Reset ball to top
    ballStartPosition.set(0, 12, 0);
    resetBall();

    // Move bowl off-screen until placed
    bowlPosition.set(100, 100, 100);
    bowl.position.copy(bowlPosition);
    bowlBody.position.copy(bowlPosition);

    // Reset star count display
    gameState.totalStars = 0;
    updateStarDisplay();

    document.getElementById('level-display').textContent = 'Editor';
    document.querySelector('.instructions').innerHTML =
        '<strong>Editor Mode:</strong> Select & drag objects, or choose a tool to place';
    updateToolIndicator('select');
});

// Test mode - play level in editor
document.getElementById('btn-test').addEventListener('click', () => {
    if (!editorState.isEditorMode) return;

    // Save current state
    testModeState.savedLevelCode = generateLevelCode();
    testModeState.isTesting = true;

    // Hide test button, show stop button
    document.getElementById('btn-test').classList.add('hidden');
    document.getElementById('btn-stop').classList.remove('hidden');

    // Start the ball
    gameState.isPlaying = true;
    isFollowing = true;
    isTransitioningToFollow = true;
    orbitAngle = Math.atan2(camera.position.x - ball.position.x, camera.position.z - ball.position.z);
    ballBody.type = CANNON.Body.DYNAMIC;
    ballBody.wakeUp();
    controls.enabled = false;

    clearGhostPreview();
    document.getElementById('tool-indicator').classList.remove('visible');

    showToast('Testing level... Click stop to return to editing');
});

// Stop testing
document.getElementById('btn-stop').addEventListener('click', () => {
    stopTesting();
});

function stopTesting() {
    if (!testModeState.isTesting) return;

    testModeState.isTesting = false;

    // Show test button, hide stop button
    document.getElementById('btn-test').classList.remove('hidden');
    document.getElementById('btn-stop').classList.add('hidden');

    // Restore level from saved state
    if (testModeState.savedLevelCode) {
        loadLevelFromCode(testModeState.savedLevelCode);
    }

    resetBall();
    updateToolIndicator(editorState.currentTool);
}

// Initialize
async function init() {
    initDOMCache();
    createBall();
    createBowl();

    await loadAllLevelData();

    showMenu();

    animate();
}

init();

console.log('🎮 Ball Drop Game initialized!');