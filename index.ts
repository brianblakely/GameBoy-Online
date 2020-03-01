import loader from "@assemblyscript/loader";

// import { RenderingBuffer } from "./platform/rendering";

let renderingBuffer;

const imports = {
  console: {
    debug: msgPtr => {
      process.env.NODE_ENV === `development` &&
        console.debug(core.__getString(msgPtr));
    },
    info: msgPtr => {
      process.env.NODE_ENV === `development` &&
        console.info(core.__getString(msgPtr));
    },
    warn: msgPtr => {
      process.env.NODE_ENV === `development` &&
        console.warn(core.__getString(msgPtr));
    },
    error: msgPtr => {
      process.env.NODE_ENV === `development` &&
        console.error(core.__getString(msgPtr));
    }
  },
  renderingBuffer: {
    set: bufferPtr =>
      renderingBuffer.setBuffer(core.__getUint8ClampedArray(bufferPtr))
  }
};

/*`loader.instantiate` will use `WebAssembly.instantiateStreaming`
   if possible. Overwise fallback to `WebAssembly.instantiate`. */
const core = loader.instantiateSync(fetch(`optimized.wasm`), imports);

const CYCLES_PER_SECOND = 4194304;
const CLOCK_CYCLES_PER_FRAME = 70224;
const FRAMERATE = CYCLES_PER_SECOND / CLOCK_CYCLES_PER_FRAME;
const FRAME_INTERVAL = 1000 / FRAMERATE;

function cout(message, level) {
  switch (level) {
    case 0:
      console.debug(message);
      break;

    case 1:
      console.info(message);
      break;

    case 2:
      console.warn(message);
      break;

    case 3:
      console.error(message);
      break;

    default:
      break;
  }
}

export var gameboy: typeof core.GameBoyCore; //GameBoyCore object.
export var gbRunInterval: NodeJS.Timeout; //GameBoyCore Timer

export function start(
  canvas: HTMLCanvasElement,
  ROM: Uint8Array,
  stringROM: string
) {
  clearLastEmulation();
  autoSave(); //If we are about to load a new game, then save the last one...
  gameboy = new core.GameBoyCore(ROM, stringROM);
  gameboy.openMBC = openSRAM;
  gameboy.openRTC = openRTC;
  gameboy.start();
  stopped = false;
  run();
}

let stopped = true;
export function stop() {
  if (!GameBoyEmulatorInitialized()) {
    cout(
      `GameBoy core cannot be stopped while it has not been initialized.`,
      1
    );
    return false;
  }

  clearLastEmulation();
  gameboy.canvas.width = gameboy.canvas.width;
  stopped = true;

  return true;
}
export function run() {
  if (GameBoyEmulatorInitialized()) {
    if (!GameBoyEmulatorPlaying()) {
      gameboy.stopEmulator &= 1;
      cout(`Starting the iterator.`, 0);
      gameboy.firstIteration = Date.now();
      gameboy.iterations = 0;
      gbRunInterval = setInterval(function() {
        if (!document.hidden) {
          gameboy.run(false);
        }
      }, FRAME_INTERVAL);
    } else {
      cout(`The GameBoy core is already running.`, 1);
    }
  } else {
    cout(`GameBoy core cannot run while it has not been initialized.`, 1);
  }
}
export function pause() {
  if (GameBoyEmulatorInitialized()) {
    if (GameBoyEmulatorPlaying()) {
      autoSave();
      clearLastEmulation();
    } else {
      cout(`GameBoy core has already been paused.`, 1);
    }
  } else {
    cout(`GameBoy core cannot be paused while it has not been initialized.`, 1);
  }
}
export function clearLastEmulation() {
  if (GameBoyEmulatorPlaying()) {
    clearInterval(gbRunInterval);
    gameboy.stopEmulator |= 2;
    cout(`The previous emulation has been cleared.`, 0);
  } else {
    cout(`No previous emulation was found to be cleared.`, 0);
  }
}

export const persistValues: Record<string, any> = {};

function setValue(key: string, value: any) {
  persistValues[key] = value;

  saveValue.push(key, value);
}

function deleteValue(key: string) {
  delete persistValues[key];

  saveValue.push(key, null);
}

function findValue(key: string) {
  return persistValues[key];
}

type SaveValueCallback = (key: string, value: any) => void;

export const saveValue: {
  callbacks: Array<SaveValueCallback>;
  push: SaveValueCallback;
  subscribe: (callback: SaveValueCallback) => void;
} = {
  callbacks: [],

  push(key, value) {
    if (this.callbacks.length) {
      this.callbacks.forEach(callback => {
        callback(key, value);
      });
    }
  },

  subscribe(callback) {
    this.callbacks.push(callback);
  }
};

export function saveState(slot: number | string | undefined) {
  if (GameBoyEmulatorInitialized()) {
    var state_suffix = typeof slot !== `undefined` ? slot : 0;
    while (
      typeof slot === `undefined` &&
      typeof state_suffix === `number` &&
      findValue(`FREEZE_` + gameboy.name + `_` + state_suffix) != null
    ) {
      state_suffix++;
    }

    const deviceState = gameboy.saveState();

    setValue(`FREEZE_` + gameboy.name + `_` + state_suffix, deviceState.state);
    // cout("Saved the current state as: FREEZE_" + gameboy.name + "_" + state_suffix, 0);

    return deviceState;
  } else {
    cout(`GameBoy core cannot be saved while it has not been initialized.`, 1);

    return {
      sram: new Uint8Array(0),
      rtc: []
    };
  }
}
function saveSRAM(cacheSRAM: Uint8Array) {
  if (GameBoyEmulatorInitialized()) {
    if (gameboy.cBATT) {
      var sram = cacheSRAM || gameboy.saveSRAMState();
      if (sram.length > 0) {
        // cout("Saving the SRAM...", 0);
        setValue(`SRAM_` + gameboy.name, sram);
      } else {
        cout(`SRAM could not be saved because it was empty.`, 1);
      }
    } else {
      // cout("Cannot save a game that does not have battery backed SRAM specified.", 1);
    }
    saveRTC();
  } else {
    cout(`GameBoy core cannot be saved while it has not been initialized.`, 1);
  }
}
function saveRTC(cacheRTC?: (number | boolean)[]) {
  //Execute this when SRAM is being saved as well.
  if (GameBoyEmulatorInitialized()) {
    if (gameboy.cTIMER) {
      // cout("Saving the RTC...", 0);
      const rtc = cacheRTC || gameboy.saveRTCState();
      setValue(`RTC_` + gameboy.name, rtc);
    }
  } else {
    cout(`GameBoy core cannot be saved while it has not been initialized.`, 1);
  }
}
export function autoSave() {
  if (GameBoyEmulatorInitialized()) {
    // cout("Automatically saving the SRAM, State, and RTC.", 0);

    const state = saveState(`auto`);

    saveSRAM(state.sram);
    saveRTC(state.rtc);

    return state;
  }

  return;
}
function openSRAM(filename: string) {
  if (findValue(`SRAM_` + filename) != null) {
    cout(`Found a previous SRAM state (Will attempt to load).`, 0);
    return findValue(`SRAM_` + filename);
  } else {
    cout(`Could not find any previous SRAM copy for the current ROM.`, 0);
  }

  return [];
}
function openRTC(filename: string) {
  if (findValue(`RTC_` + filename) != null) {
    cout(`Found a previous RTC state (Will attempt to load).`, 0);
    return findValue(`RTC_` + filename);
  } else {
    cout(`Could not find any previous RTC copy for the current ROM.`, 0);
  }

  return [];
}
export function openState(
  slot: number,
  canvas: HTMLCanvasElement,
  stringROM: string
) {
  const filename = `FREEZE_` + gameboy.name + `_` + slot;

  if (findValue(filename) != null) {
    clearLastEmulation();
    cout(`Attempting to run a saved emulation state.`, 0);
    const { ROM } = gameboy;
    gameboy = new core.GameBoyCore(new Uint8Array(0), stringROM);
    gameboy.ROM = ROM;
    gameboy.savedStateFileName = filename;
    gameboy.returnFromState(findValue(filename), false);
    run();
  } else {
    cout(`Could not find the save state ` + filename + `".`, 2);
  }
}

export function GameBoyEmulatorInitialized() {
  return typeof gameboy == `object` && stopped !== true;
}
export function GameBoyEmulatorPlaying() {
  return GameBoyEmulatorInitialized() && (gameboy.stopEmulator & 2) == 0;
}

export function GameBoyJoyPadEvent(keycode: number, down: boolean) {
  if (GameBoyEmulatorPlaying()) {
    if (keycode >= 0 && keycode < 8) {
      gameboy.JoyPadEvent(keycode, down);
    }
  }
}

// function GameBoyGyroSignalHandler(e) {
//   if (GameBoyEmulatorPlaying()) {
//     if (e.gamma || e.beta) {
//       gameboy.GyroEvent((e.gamma * Math.PI) / 180, (e.beta * Math.PI) / 180);
//     } else {
//       gameboy.GyroEvent(e.x, e.y);
//     }

//     if (e.preventDefault !== undefined) {
//       e.preventDefault();
//     }
//   }
// }
