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

// Editor State
const editorState = {
    isEditorMode: false,
    currentTool: 'star',
    levelObjects: {
        stars: [],
        bowl: { x: 0, y: -11.5, z: 0 },
        walls: [],
        boosters: [],
        spikes: []
    }
};

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
    const grid = document.getElementById('levels-grid');
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
        // Shake the card
        cardElement.classList.add('shake');
        setTimeout(() => cardElement.classList.remove('shake'), 500);

        // Show toast
        showToast('🔒 Complete the previous level first!');
        return;
    }

    // Load the level
    gameState.level = levelNum;
    const levelData = menuState.levels[levelNum - 1];
    if (levelData) {
        loadLevelFromCode(levelData.code);
    }
    document.getElementById('level-display').textContent = `Level ${levelNum}`;

    // Hide menu
    document.getElementById('menu-overlay').classList.add('hidden');
}

// Show toast message
function showToast(message) {
    const toast = document.getElementById('locked-toast');
    toast.textContent = message;
    toast.classList.add('visible');
    setTimeout(() => toast.classList.remove('visible'), 2000);
}

// Show menu
function showMenu() {
    updateMaxUnlocked();
    renderLevelMenu();
    document.getElementById('menu-overlay').classList.remove('hidden');
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

// Level object meshes for editor
const editorObjects = {
    walls: [],
    boosters: [],
    spikes: []
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

function createGlowTexture() {
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

    const texture = new THREE.CanvasTexture(canvas);
    return texture;
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
function createBooster(position, direction, strength = 20) {
    const geometry = new THREE.ConeGeometry(0.5, 1.2, 8);
    const material = new THREE.MeshStandardMaterial({
        color: 0x0071e3,
        emissive: 0x0071e3,
        emissiveIntensity: 0.5,
        roughness: 0.2,
        metalness: 0.8
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(position.x, position.y, position.z);

    // Point in boost direction
    const dir = new THREE.Vector3(direction.x, direction.y, direction.z).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const quaternion = new THREE.Quaternion().setFromUnitVectors(up, dir);
    mesh.quaternion.copy(quaternion);
    mesh.castShadow = true;
    scene.add(mesh);

    // Trigger zone (no physics body, just detection)
    const boosterData = {
        mesh,
        position: { ...position },
        direction: { x: dir.x, y: dir.y, z: dir.z },
        strength,
        type: 'booster'
    };
    editorObjects.boosters.push(boosterData);
    return boosterData;
}

// Create spike
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
// Level code generation
function generateLevelCode() {
    const lines = [];

    // Ball start position
    lines.push(`BALL:${ballStartPosition.x},${ballStartPosition.y},${ballStartPosition.z}`);

    // Bowl
    lines.push(`BOWL:${bowlPosition.x},${bowlPosition.y},${bowlPosition.z}`);

    // Stars
    gameState.starObjects.forEach(star => {
        const pos = star.mesh.position;
        lines.push(`STAR:${pos.x.toFixed(2)},${pos.y.toFixed(2)},${pos.z.toFixed(2)}`);
    });

    // Walls
    editorObjects.walls.forEach(wall => {
        lines.push(`WALL:${wall.start.x.toFixed(2)},${wall.start.y.toFixed(2)},${wall.start.z.toFixed(2)},${wall.end.x.toFixed(2)},${wall.end.y.toFixed(2)},${wall.end.z.toFixed(2)}`);
    });

    // Boosters
    editorObjects.boosters.forEach(booster => {
        lines.push(`BOOSTER:${booster.position.x.toFixed(2)},${booster.position.y.toFixed(2)},${booster.position.z.toFixed(2)},${booster.direction.x.toFixed(2)},${booster.direction.y.toFixed(2)},${booster.direction.z.toFixed(2)},${booster.strength}`);
    });

    // Spikes
    editorObjects.spikes.forEach(spike => {
        lines.push(`SPIKE:${spike.position.x.toFixed(2)},${spike.position.y.toFixed(2)},${spike.position.z.toFixed(2)}`);
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
                data.boosters.push({
                    position: { x: values[0], y: values[1], z: values[2] },
                    direction: { x: values[3], y: values[4], z: values[5] },
                    strength: values[6] || 20
                });
                break;
            case 'SPIKE':
                data.spikes.push({ x: values[0], y: values[1], z: values[2] });
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

    // Create boosters
    data.boosters.forEach(booster => {
        createBooster(booster.position, booster.direction, booster.strength);
    });

    // Create spikes
    data.spikes.forEach(spike => {
        createSpikeAtPosition(spike);
    });

    // Create ramps from level data
    data.ramps.forEach(ramp => {
        createRampFromData(ramp);
    });

    resetBall();
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
    });
    editorObjects.boosters = [];

    // Clear spikes
    editorObjects.spikes.forEach(obj => {
        scene.remove(obj.mesh);
        if (obj.body) world.removeBody(obj.body);
    });
    editorObjects.spikes = [];

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

// Event handlers
function onMouseDown(event) {
    if (event.button !== 0) return;
    if (event.target !== renderer.domElement) return;

    const pos = getWorldPosition(event);

    if (editorState.isEditorMode) {
        handleEditorClick(pos, event);
        return;
    }

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
            bowlPosition.set(pos.x, -11.1, pos.z);
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
        case 'delete':
            deleteObjectAt(pos);
            break;
    }
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

function onMouseMove(event) {
    if (!gameState.isDragging) return;

    gameState.dragEnd = getWorldPosition(event);
    updatePreview(gameState.dragStart, gameState.dragEnd);
}

function onMouseUp(event) {
    if (!gameState.isDragging) return;

    gameState.isDragging = false;
    document.getElementById('preview-info').classList.remove('visible');
    controls.enabled = true;

    if (gameState.dragStart && gameState.dragEnd) {
        if (editorState.isEditorMode) {
            if (editorState.currentTool === 'wall') {
                createWall(gameState.dragStart, gameState.dragEnd);
            } else if (editorState.currentTool === 'booster') {
                const direction = new THREE.Vector3().subVectors(gameState.dragEnd, gameState.dragStart).normalize();
                createBooster(gameState.dragStart, direction, 20);
            }
        } else {
            createRamp(gameState.dragStart, gameState.dragEnd, gameState.currentTool);
        }
    }

    gameState.dragStart = null;
    gameState.dragEnd = null;

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
    document.getElementById('star-count').textContent = `${gameState.stars} / ${gameState.totalStars}`;
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
function showWinModal() {
    completeLevel(gameState.level);
    const modal = document.getElementById('win-modal');
    modal.classList.add('active');
}

// Check collisions
function checkCollisions() {
    if (!gameState.isPlaying) return;

    const ballPos = new THREE.Vector3(
        ballBody.position.x,
        ballBody.position.y,
        ballBody.position.z
    );

    // Check star collisions
    gameState.starObjects.forEach(star => {
        if (star.collected) return;

        const dist = ballPos.distanceTo(star.mesh.position);
        if (dist < 1) {
            star.collected = true;
            star.mesh.visible = false;
            gameState.stars++;
            updateStarDisplay();
            showStarCollectAnimation(star.mesh.position);
        }
    });

    // Check booster collisions
    editorObjects.boosters.forEach(booster => {
        const boosterPos = new THREE.Vector3(booster.position.x, booster.position.y, booster.position.z);
        const dist = ballPos.distanceTo(boosterPos);
        if (dist < 1.5) {
            // Apply boost force
            ballBody.velocity.x += booster.direction.x * booster.strength * 0.5;
            ballBody.velocity.y += booster.direction.y * booster.strength * 0.5;
            ballBody.velocity.z += booster.direction.z * booster.strength * 0.5;
        }
    });

    // Check spike collisions
    editorObjects.spikes.forEach(spike => {
        const spikePos = new THREE.Vector3(spike.position.x, spike.position.y, spike.position.z);
        const dist = ballPos.distanceTo(spikePos);
        if (dist < 0.8) {
            // Hit spike - reset
            resetBall();
            return;
        }
    });

    // Check bowl collision
    const bowlDist = ballPos.distanceTo(bowlPosition);
    if (bowlDist < 2 && ballPos.y < bowlPosition.y + 1) {
        gameState.isPlaying = false;
        setTimeout(showWinModal, 500);
    }

    // Check if ball fell below ground
    if (ballPos.y < -15) {
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

    // Sync ball mesh to physics body
    if (ball && ballBody) {
        ball.position.set(ballBody.position.x, ballBody.position.y, ballBody.position.z);
        ball.quaternion.set(ballBody.quaternion.x, ballBody.quaternion.y, ballBody.quaternion.z, ballBody.quaternion.w);
        // Update ball trail
        // updateTrail();
        // Update burst particles
        updateBurstParticles(delta);
    }

    // Animate stars
    gameState.starObjects.forEach((star, i) => {
        if (!star.collected) {
            star.mesh.rotation.y += 0.02;
            star.mesh.position.y += Math.sin(Date.now() * 0.003 + i) * 0.002;

            // Pulsing glow effect
            const pulse = 0.4 + Math.sin(Date.now() * 0.005 + i * 0.5) * 0.2;
            if (star.mesh.userData.light) {
                star.mesh.userData.light.intensity = 1.5 + pulse;
            }
            if (star.mesh.userData.glow) {
                star.mesh.userData.glow.material.opacity = 0.4 + pulse * 0.4;
                const glowScale = 2.5 + pulse;
                star.mesh.userData.glow.scale.set(glowScale, glowScale, 1);
            }
        }
    });

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

    if (editorState.isEditorMode) {
        document.querySelector('.instructions').innerHTML =
            '<strong>Editor Mode:</strong> Select a tool and click/drag to place objects';
    } else {
        document.querySelector('.instructions').innerHTML =
            '<strong>Click and drag</strong> to place ramps • <strong>Scroll</strong> to zoom • <strong>Right-drag</strong> to rotate view';
    }
});

// Editor tool selection
document.querySelectorAll('[data-editor-tool]').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('[data-editor-tool]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        editorState.currentTool = btn.dataset.editorTool;
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
    document.getElementById('editor-toolbar').style.display = 'flex';
    document.getElementById('btn-editor').classList.add('active');

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
        '<strong>Editor Mode:</strong> Select a tool and click/drag to place objects • Export to save your level';
});

// Initialize
async function init() {
    createBall();
    createBowl();

    // Load all level data for menu
    await loadAllLevelData();

    // Show menu on start
    showMenu();

    animate();
}

init();

console.log('🎮 Ball Drop Game initialized!');