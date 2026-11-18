import test from 'node:test';
import assert from 'node:assert/strict';
import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import {
  extractObservationFromLandmarks,
  isChallengeObserved,
  type FrameLivenessObservation,
} from '../lib/livenessCapture.js';

function makeBlankLandmarks(): NormalizedLandmark[] {
  const arr: NormalizedLandmark[] = Array.from({ length: 478 }, () => ({
    x: 0.5,
    y: 0.5,
    z: 0,
    visibility: 1,
  }));
  // Cheek & nose landmarks
  arr[234] = { x: 0.3, y: 0.5, z: 0, visibility: 1 };
  arr[454] = { x: 0.7, y: 0.5, z: 0, visibility: 1 };
  arr[1] = { x: 0.5, y: 0.52, z: -0.05, visibility: 1 };

  // Left eye [33, 160, 158, 133, 153, 144] -> open EAR ~ 0.32
  arr[33] = { x: 0.38, y: 0.42, z: 0, visibility: 1 };
  arr[133] = { x: 0.44, y: 0.42, z: 0, visibility: 1 };
  arr[160] = { x: 0.4, y: 0.41, z: 0, visibility: 1 };
  arr[158] = { x: 0.42, y: 0.41, z: 0, visibility: 1 };
  arr[153] = { x: 0.42, y: 0.43, z: 0, visibility: 1 };
  arr[144] = { x: 0.4, y: 0.43, z: 0, visibility: 1 };

  // Right eye [362, 385, 387, 263, 373, 380] -> open EAR ~ 0.32
  arr[362] = { x: 0.56, y: 0.42, z: 0, visibility: 1 };
  arr[263] = { x: 0.62, y: 0.42, z: 0, visibility: 1 };
  arr[385] = { x: 0.58, y: 0.41, z: 0, visibility: 1 };
  arr[387] = { x: 0.6, y: 0.41, z: 0, visibility: 1 };
  arr[373] = { x: 0.6, y: 0.43, z: 0, visibility: 1 };
  arr[380] = { x: 0.58, y: 0.43, z: 0, visibility: 1 };

  return arr;
}

test('extractObservationFromLandmarks computes open-eye EAR, neutral yaw, and multi-face count', () => {
  const empty = extractObservationFromLandmarks([]);
  assert.equal(empty.facePresent, false);
  assert.equal(empty.faceCount, 0);

  const open = makeBlankLandmarks();
  const obs = extractObservationFromLandmarks([open]);
  assert.equal(obs.facePresent, true);
  assert.equal(obs.faceCount, 1);
  assert.ok(obs.ear !== null && obs.ear > 0.28);
  assert.ok(obs.yawProxy !== null && Math.abs(obs.yawProxy) < 0.02);

  const multi = extractObservationFromLandmarks([open, open]);
  assert.equal(multi.faceCount, 2);
});

test('isChallengeObserved validates BLINK, TURN_LEFT, TURN_RIGHT and rejects static bursts', () => {
  const openObs: FrameLivenessObservation = {
    facePresent: true,
    faceCount: 1,
    ear: 0.31,
    blinkScore: 0.05,
    yawProxy: 0.01,
  };
  const blinkObs: FrameLivenessObservation = {
    facePresent: true,
    faceCount: 1,
    ear: 0.14,
    blinkScore: 0.72,
    yawProxy: 0.01,
  };
  const turnLeftObs: FrameLivenessObservation = {
    facePresent: true,
    faceCount: 1,
    ear: 0.3,
    blinkScore: 0.05,
    yawProxy: 0.28,
  };
  const turnRightObs: FrameLivenessObservation = {
    facePresent: true,
    faceCount: 1,
    ear: 0.3,
    blinkScore: 0.05,
    yawProxy: -0.26,
  };

  // Static photo fails all challenges
  assert.equal(isChallengeObserved('BLINK', [openObs, openObs, openObs, openObs]), false);
  assert.equal(isChallengeObserved('TURN_LEFT', [openObs, openObs, openObs, openObs]), false);
  assert.equal(isChallengeObserved('TURN_RIGHT', [openObs, openObs, openObs, openObs]), false);

  // Genuine blink passes BLINK, fails TURN_LEFT
  assert.equal(isChallengeObserved('BLINK', [openObs, blinkObs, openObs, openObs]), true);
  assert.equal(isChallengeObserved('TURN_LEFT', [openObs, blinkObs, openObs, openObs]), false);

  // Genuine directional head turns pass only matching direction
  assert.equal(isChallengeObserved('TURN_LEFT', [openObs, openObs, turnLeftObs, openObs]), true);
  assert.equal(isChallengeObserved('TURN_RIGHT', [openObs, openObs, turnLeftObs, openObs]), false);
  assert.equal(isChallengeObserved('TURN_RIGHT', [openObs, openObs, turnRightObs, openObs]), true);
});
