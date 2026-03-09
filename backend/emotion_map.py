"""Emotion to TalkingHead expression mapping."""

# Maps LLM emotion labels to TalkingHead ARKit blend shape values.
# Each emotion is a dict of ARKit blend shape names -> values (0.0 - 1.0).

EMOTION_MAP = {
    "friendly": {
        "mouthSmileLeft": 0.4,
        "mouthSmileRight": 0.4,
        "eyeSquintLeft": 0.15,
        "eyeSquintRight": 0.15,
        "cheekSquintLeft": 0.2,
        "cheekSquintRight": 0.2,
    },
    "interested": {
        "browInnerUp": 0.3,
        "eyeWideLeft": 0.2,
        "eyeWideRight": 0.2,
        "mouthSmileLeft": 0.2,
        "mouthSmileRight": 0.2,
    },
    "empathetic": {
        "browInnerUp": 0.25,
        "browDownLeft": 0.1,
        "browDownRight": 0.1,
        "mouthSmileLeft": 0.15,
        "mouthSmileRight": 0.15,
        "mouthFrownLeft": 0.1,
        "mouthFrownRight": 0.1,
    },
    "surprised": {
        "browInnerUp": 0.5,
        "browOuterUpLeft": 0.4,
        "browOuterUpRight": 0.4,
        "eyeWideLeft": 0.4,
        "eyeWideRight": 0.4,
        "jawOpen": 0.15,
    },
    "thinking": {
        "browDownLeft": 0.2,
        "browInnerUp": 0.15,
        "eyeLookUpLeft": 0.3,
        "eyeLookUpRight": 0.3,
        "mouthPucker": 0.15,
    },
    "grateful": {
        "mouthSmileLeft": 0.5,
        "mouthSmileRight": 0.5,
        "eyeSquintLeft": 0.2,
        "eyeSquintRight": 0.2,
        "cheekSquintLeft": 0.3,
        "cheekSquintRight": 0.3,
        "browInnerUp": 0.15,
    },
    "encouraging": {
        "mouthSmileLeft": 0.35,
        "mouthSmileRight": 0.35,
        "browInnerUp": 0.2,
        "browOuterUpLeft": 0.15,
        "browOuterUpRight": 0.15,
        "eyeWideLeft": 0.1,
        "eyeWideRight": 0.1,
    },
    "listening": {
        "mouthSmileLeft": 0.15,
        "mouthSmileRight": 0.15,
        "browInnerUp": 0.1,
    },
    "neutral": {},
}

# Maps gesture labels to Mixamo animation names
GESTURE_MAP = {
    "idle": "idle",
    "talking": "talking",
    "nodding": "nodding",
    "waving": "waving",
    "bow": "bow",
    "thinking": "thinking",
    "lean_forward": "lean_forward",
}
