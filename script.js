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
        color: 0xff9500,
        roughness: 0.3,
        metalness: 0.6,
        emissive: 0xff9500,
        emissiveIntensity: 0.2
    });

    const star = new THREE.Mesh(starGeometry, starMaterial);
    star.position.copy(position);
    star.castShadow = true;
    star.userData.index = index;
    star.userData.collected = false;
    scene.add(star);

    // Physics sensor
    const sphereShape = new CANNON.Sphere(0.6);
    const starBody = new CANNON.Body({ mass: 0, isTrigger: true });
    starBody.addShape(sphereShape);
    starBody.position.copy(position);
    world.addBody(starBody);

    gameState.starObjects.push({ mesh: star, body: starBody, collected: false });
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
    if (event.button !== 0) return; // Only left click
    if (event.target !== renderer.domElement) return;

    gameState.isDragging = true;
    gameState.dragStart = getWorldPosition(event);
    document.getElementById('preview-info').classList.add('visible');
    controls.enabled = false;
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
        createRamp(gameState.dragStart, gameState.dragEnd, gameState.currentTool);
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

function nextLevel() {
    document.getElementById('win-modal').classList.remove('active');
    gameState.level++;
    document.getElementById('level-display').textContent = `Level ${gameState.level}`;

    clearAllRamps();
    createStars();
    resetBall();

    // Move bowl slightly for variety
    const angle = gameState.level * 0.5;
    bowlPosition.x = Math.sin(angle) * 3;
    bowlPosition.y = -11.25;
    bowl.position.copy(bowlPosition);
    bowlBody.position.copy(bowlPosition);
}

function updateStarDisplay() {
    document.getElementById('star-count').textContent = `${gameState.stars} / ${gameState.totalStars}`;
}

function showStarCollectAnimation(position) {
    // Project 3D position to 2D
    const vector = position.clone().project(camera);
    const x = (vector.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-vector.y * 0.5 + 0.5) * window.innerHeight;

    const popup = document.createElement('div');
    popup.className = 'star-popup';
    popup.textContent = '⭐';
    popup.style.left = x + 'px';
    popup.style.top = y + 'px';
    document.querySelector('.ui-overlay').appendChild(popup);

    setTimeout(() => popup.remove(), 1000);

    // Play sound effect (simple beep using Web Audio)
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);

        oscillator.frequency.value = 880;
        oscillator.type = 'sine';
        gainNode.gain.setValueAtTime(0.3, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.2);

        oscillator.start(audioCtx.currentTime);
        oscillator.stop(audioCtx.currentTime + 0.2);
    } catch (e) { }
}

function showWinModal() {
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

    // Check bowl collision
    const bowlDist = ballPos.distanceTo(bowlPosition);
    if (bowlDist < 2 && ballPos.y < bowlPosition.y + 1) {
        // Win!
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
    }

    // Animate stars
    gameState.starObjects.forEach((star, i) => {
        if (!star.collected) {
            star.mesh.rotation.y += 0.02;
            star.mesh.position.y += Math.sin(Date.now() * 0.003 + i) * 0.002;
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

// Initialize
createBall();
createBowl();
createStars();
animate();

console.log('🎮 Ball Drop Game initialized! Click and drag to place ramps, then press play!');