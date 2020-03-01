import { XAudioServer } from "./audio";

// Declare external imports.
declare namespace console {
  function debug(msg: string): void;
  function info(msg: string): void;
  function warn(msg: string): void;
  function error(msg: string): void;
}

declare namespace renderingBuffer {
  function set(buffer: Uint8ClampedArray): void;
}

/*
 * JavaScript GameBoy Color Emulator
 * Copyright (C) 2010 - 2012 Grant Galitz
 *
 * This program is free software; you can redistribute it and/or
 * modify it under the terms of the GNU General Public License
 * version 2 as published by the Free Software Foundation.
 * The full license is available at http://www.gnu.org/licenses/gpl.html
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 */
function cout(message: string, level: number) {
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

const CYCLES_PER_SECOND = 4194304;
const CLOCK_CYCLES_PER_FRAME = 70224;
const FRAMERATE = CYCLES_PER_SECOND / CLOCK_CYCLES_PER_FRAME;
const FRAME_INTERVAL = 1000 / FRAMERATE;

// Audio buffer minimum/maximum span amount over N interpreter iterations.
const AUDIO_BUFFER_SPAN_MIN = 10;
const AUDIO_BUFFER_SPAN_MAX = 20;

const GBWIDTH = 160;
const GBHEIGHT = 144;

export class GameBoyCore {
  //Params, etc...
  ROMImage: Uint8Array; //The game's ROM.
  //CPU Registers and Flags:
  registerA = 0x01; //Register A (Accumulator)
  FZero = true; //Register F  - Result was zero
  FSubtract = false; //Register F  - Subtraction was executed
  FHalfCarry = true; //Register F  - Half carry or half borrow
  FCarry = true; //Register F  - Carry or borrow
  registerB = 0x00; //Register B
  registerC = 0x13; //Register C
  registerD = 0x00; //Register D
  registerE = 0xd8; //Register E
  registersHL = 0x014d; //Registers H and L combined
  stackPointer = 0xfffe; //Stack Pointer
  programCounter = 0x0100; //Program Counter
  //Some CPU Emulation State Variables:
  CPUCyclesTotal = 0; //Relative CPU clocking to speed set, rounded appropriately.
  CPUCyclesTotalBase = 0; //Relative CPU clocking to speed set base.
  CPUCyclesTotalCurrent = 0; //Relative CPU clocking to speed set, the directly used value.
  CPUCyclesTotalRoundoff = 0; //Clocking per iteration rounding catch.
  baseCPUCyclesPerIteration = 0; //CPU clocks per iteration at 1x speed.
  remainingClocks = 0; //HALT clocking overrun carry over.
  inBootstrap = true; //Whether we're in the GBC boot ROM.
  usedBootROM = false; //Updated upon ROM loading...
  usedGBCBootROM = false; //Did we boot to the GBC boot ROM?
  halt = false; //Has the CPU been suspended until the next interrupt?
  skipPCIncrement = false; //Did we trip the DMG Halt bug?
  stopEmulator = 3; //Has the emulation been paused or a frame has ended?
  IME = true; //Are interrupts enabled?
  IRQLineMatched = 0; //CPU IRQ assertion.
  interruptsRequested = 0; //IF Register
  interruptsEnabled = 0; //IE Register
  hdmaRunning = false; //HDMA Transfer Flag - GBC only
  CPUTicks = 0; //The number of clock cycles emulated.
  doubleSpeedShifter = 0; //GBC double speed clocking shifter.
  JoyPad = 0xff; //Joypad State (two four-bit states actually)
  CPUStopped = false; //CPU STOP status.
  //Main RAM, MBC RAM, GBC Main RAM, VRAM, etc.
  memoryReader: {
    (parentObj: GameBoyCore, programCounter: number): number;
  }[] = []; //Array of functions mapped to read back memory
  memoryWriter: {
    (parentObj: GameBoyCore, registerStart: number, registerEnd: number): void;
  }[] = []; //Array of functions mapped to write to memory
  memoryHighReader: {
    (parentObj: GameBoyCore, programCounter: number): number;
  }[] = []; //Array of functions mapped to read back 0xFFXX memory
  memoryHighWriter: {
    (parentObj: GameBoyCore, registerStart: number, registerEnd: number): void;
  }[] = []; //Array of functions mapped to write to 0xFFXX memory
  ROM: Uint8Array = new Uint8Array(0); //The full ROM file dumped to an array.
  memory: Uint8Array = new Uint8Array(0); //Main Core Memory
  MBCRam: Uint8Array = new Uint8Array(0); //Switchable RAM (Used by games for more RAM) for the main memory range 0xA000 - 0xC000.
  VRAM: Uint8Array = new Uint8Array(0); //Extra VRAM bank for GBC.
  GBCMemory: Uint8Array = new Uint8Array(0); //GBC main RAM Banks
  MBC1Mode = false; //MBC1 Type (4/32, 16/8)
  MBCRAMBanksEnabled = false; //MBC RAM Access Control.
  currMBCRAMBank = 0; //MBC Currently Indexed RAM Bank
  currMBCRAMBankPosition = -0xa000; //MBC Position Adder;
  cGBC = false; //GameBoy Color detection.
  gbcRamBank = 1; //Currently Switched GameBoy Color ram bank
  gbcRamBankPosition = -0xd000; //GBC RAM offset from address start.
  gbcRamBankPositionECHO = -0xf000; //GBC RAM (ECHO mirroring) offset from address start.
  RAMBanks = [0, 1, 2, 4, 16]; //Used to map the RAM banks to maximum size the MBC used can do.
  ROMBank1offs = 0; //Offset of the ROM bank switching.
  currentROMBank = 0; //The parsed current ROM bank selection.
  cartridgeType = 0; //Cartridge Type
  name = ``; //Name of the game
  gameCode = ``; //Game code (Suffix for older games)
  fromSaveState = false; //A boolean to see if this was loaded in as a save state.
  savedStateFileName = ""; //When loaded in as a save state, this will not be empty.
  STATTracker = 0; //Tracker for STAT triggering.
  modeSTAT = 0; //The scan line mode (for lines 1-144 it's 2-3-0, for 145-154 it's 1)
  spriteCount = 252; //Mode 3 extra clocking counter (Depends on how many sprites are on the current line.).
  LYCMatchTriggerSTAT = false; //Should we trigger an interrupt if LY==LYC?
  mode2TriggerSTAT = false; //Should we trigger an interrupt if in mode 2?
  mode1TriggerSTAT = false; //Should we trigger an interrupt if in mode 1?
  mode0TriggerSTAT = false; //Should we trigger an interrupt if in mode 0?
  LCDisOn = false; //Is the emulated LCD controller on?
  LINECONTROL: {
    (parentObj: GameBoyCore): void;
  }[] = []; //Array of functions to handle each scan line we do
  DISPLAYOFFCONTROL = [
    function(parentObj: GameBoyCore) {
      //Array of line 0 function to handle the LCD controller when it's off (Do nothing!).
    }
  ];
  LCDCONTROL: {
    (parentObj: GameBoyCore): void;
  }[] = []; //Pointer to either LINECONTROL or DISPLAYOFFCONTROL.
  //RTC (Real Time Clock for MBC3):
  RTCisLatched = false;
  latchedSeconds = 0; //RTC latched seconds.
  latchedMinutes = 0; //RTC latched minutes.
  latchedHours = 0; //RTC latched hours.
  latchedLDays = 0; //RTC latched lower 8-bits of the day counter.
  latchedHDays = 0; //RTC latched high-bit of the day counter.
  RTCSeconds = 0; //RTC seconds counter.
  RTCMinutes = 0; //RTC minutes counter.
  RTCHours = 0; //RTC hours counter.
  RTCDays = 0; //RTC days counter.
  RTCDayOverFlow = false; //Did the RTC overflow and wrap the day counter?
  RTCHALT = false; //Is the RTC allowed to clock up?
  //Gyro:
  highX = 127;
  lowX = 127;
  highY = 127;
  lowY = 127;
  //Sound variables:
  audioHandle: XAudioServer; //XAudioJS handle
  muted = false;
  numSamplesTotal = 0; //Length of the sound buffers.
  dutyLookup = [
    //Map the duty values given to ones we can work with.
    [false, false, false, false, false, false, false, true],
    [true, false, false, false, false, false, false, true],
    [true, false, false, false, false, true, true, true],
    [false, true, true, true, true, true, true, false]
  ];
  bufferContainAmount = 0; //Buffer maintenance metric.
  LSFR15Table: Int8Array;
  LSFR7Table: Int8Array;
  noiseSampleTable: Int8Array;
  soundMasterEnabled = false; //As its name implies
  channel3PCM: Int8Array = new Int8Array(0); //Channel 3 adjusted sample buffer.
  //Vin Shit:
  VinLeftChannelMasterVolume = 8; //Computed post-mixing volume.
  VinRightChannelMasterVolume = 8; //Computed post-mixing volume.
  //Channel paths enabled:
  leftChannel1 = false;
  leftChannel2 = false;
  leftChannel3 = false;
  leftChannel4 = false;
  rightChannel1 = false;
  rightChannel2 = false;
  rightChannel3 = false;
  rightChannel4 = false;
  audioClocksUntilNextEvent = 1;
  audioClocksUntilNextEventCounter = 1;
  //Channel output level caches:
  channel1currentSampleLeft = 0;
  channel1currentSampleRight = 0;
  channel2currentSampleLeft = 0;
  channel2currentSampleRight = 0;
  channel3currentSampleLeft = 0;
  channel3currentSampleRight = 0;
  channel4currentSampleLeft = 0;
  channel4currentSampleRight = 0;
  channel1currentSampleLeftSecondary = 0;
  channel1currentSampleRightSecondary = 0;
  channel2currentSampleLeftSecondary = 0;
  channel2currentSampleRightSecondary = 0;
  channel3currentSampleLeftSecondary = 0;
  channel3currentSampleRightSecondary = 0;
  channel4currentSampleLeftSecondary = 0;
  channel4currentSampleRightSecondary = 0;
  channel1currentSampleLeftTrimary = 0;
  channel1currentSampleRightTrimary = 0;
  channel2currentSampleLeftTrimary = 0;
  channel2currentSampleRightTrimary = 0;
  mixerOutputCache = 0;
  //Pre-multipliers to cache some calculations:
  emulatorSpeed = 1;
  //Audio generation counters:
  audioTicks = 0; //Used to sample the audio system every x CPU instructions.
  audioIndex = 0; //Used to keep alignment on audio generation.
  downsampleInput = 0;
  audioDestinationPosition = 0; //Used to keep alignment on audio generation.
  rollover = 0; //Used to keep alignment on the number of samples to output (Realign from counter alias).
  //Timing Variables
  emulatorTicks = 0; //Times for how many instructions to execute before ending the loop.
  DIVTicks = 56; //DIV Ticks Counter (Invisible lower 8-bit)
  LCDTicks = 60; //Counter for how many instructions have been executed on a scanline so far.
  timerTicks = 0; //Counter for the TIMA timer.
  TIMAEnabled = false; //Is TIMA enabled?
  TACClocker = 1024; //Timer Max Ticks
  serialTimer = 0; //Serial IRQ Timer
  serialShiftTimer = 0; //Serial Transfer Shift Timer
  serialShiftTimerAllocated = 0; //Serial Transfer Shift Timer Refill
  IRQEnableDelay = 0; //Are the interrupts on queue to be enabled?
  lastIteration = Date.now(); //The last time we iterated the main loop.
  firstIteration = Date.now();
  iterations = 0;
  actualScanLine = 0; //Actual scan line...
  lastUnrenderedLine = 0; //Last rendered scan line...
  queuedScanLines = 0;
  totalLinesPassed = 0;
  haltPostClocks = 0; //Post-Halt clocking.
  //ROM Cartridge Components:
  cBATT = false; //Does the cartridge have battery save?
  cMBC1 = false; //Does the cartridge use MBC1?
  cMBC2 = false; //Does the cartridge use MBC2?
  cMBC3 = false; //Does the cartridge use MBC3?
  cMBC5 = false; //Does the cartridge use MBC5?
  cMBC7 = false; //Does the cartridge use MBC7?
  cSRAM = false; //Does the cartridge use save RAM?
  cMMMO1 = false; //...
  cRUMBLE = false; //Does the cartridge use the RUMBLE addressing (modified MBC5)?
  cCamera = false; //Is the cartridge actually a GameBoy Camera?
  cTAMA5 = false; //Does the cartridge use TAMA5? (Tamagotchi Cartridge)
  cHuC3 = false; //Does the cartridge use HuC3 (Hudson Soft / modified MBC3)?
  cHuC1 = false; //Does the cartridge use HuC1 (Hudson Soft / modified MBC1)?
  cTIMER = false; //Does the cartridge have an RTC?
  numROMBanks: number;
  ROMBanks = [
    // 1 Bank = 16 KBytes = 256 Kbits
    2,
    4,
    8,
    16,
    32,
    64,
    128,
    256,
    512
  ];
  numRAMBanks = 0; //How many RAM banks were actually allocated?
  ////Graphics Variables
  currVRAMBank = 0; //Current VRAM bank for GBC.
  backgroundX = 0; //Register SCX (X-Scroll)
  backgroundY = 0; //Register SCY (Y-Scroll)
  gfxWindowDisplay = false; //Is the windows enabled?
  gfxSpriteShow = false; //Are sprites enabled?
  gfxSpriteNormalHeight = true; //Are we doing 8x8 or 8x16 sprites?
  bgEnabled = true; //Is the BG enabled?
  BGPriorityEnabled = true; //Can we flag the BG for priority over sprites?
  gfxWindowCHRBankPosition = 0; //The current bank of the character map the window uses.
  gfxBackgroundCHRBankPosition = 0; //The current bank of the character map the BG uses.
  gfxBackgroundBankOffset = 0x80; //Fast mapping of the tile numbering/
  windowY = 0; //Current Y offset of the window.
  windowX = 0; //Current X offset of the window.
  drewBlank = 0; //To prevent the repeating of drawing a blank screen.
  drewFrame = false; //Throttle how many draws we can do to once per iteration.
  midScanlineOffset = -1; //mid-scanline rendering offset.
  pixelEnd = 0; //track the x-coord limit for line rendering (mid-scanline usage).
  currentX = 0; //The x-coord we left off at for mid-scanline rendering.
  //BG Tile Pointer Caches:
  BGCHRBank1: Uint8Array = new Uint8Array(0);
  BGCHRBank2: Uint8Array = new Uint8Array(0);
  BGCHRCurrentBank: Uint8Array;
  //Tile Data Cache:
  tileCache: Uint8Array[];
  //Palettes:
  colors = [0xefffde, 0xadd794, 0x529273, 0x183442]; //"Classic" GameBoy palette colors.
  OBJPalette: Int32Array;
  BGPalette: Int32Array;
  gbcOBJRawPalette: Uint8Array = new Uint8Array(0);
  gbcBGRawPalette: Uint8Array = new Uint8Array(0);
  gbOBJPalette: Int32Array = new Int32Array(0);
  gbBGPalette: Int32Array = new Int32Array(0);
  gbcOBJPalette: Int32Array = new Int32Array(0);
  gbcBGPalette: Int32Array = new Int32Array(0);
  gbBGColorizedPalette: Int32Array = new Int32Array(0);
  gbOBJColorizedPalette: Int32Array = new Int32Array(0);
  cachedBGPaletteConversion: Int32Array = new Int32Array(0);
  cachedOBJPaletteConversion: Int32Array = new Int32Array(0);
  updateGBBGPalette: (data: number) => void;
  updateGBOBJPalette: (index: number, data: number) => void;
  colorizedGBPalettes = false;
  BGLayerRender: (scanlineToRender: number) => void; //Reference to the BG rendering function.
  WindowLayerRender: (scanlineToRender: number) => void; //Reference to the window rendering function.
  SpriteLayerRender: (scanlineToRender: number) => void; //Reference to the OAM rendering function.
  frameBuffer: Int32Array = new Int32Array(0); //The internal frame-buffer.
  swizzledFrame: Uint8Array; //The secondary gfx buffer that holds the converted RGBA values.
  canvasBuffer: Uint8ClampedArray; //imageData handle
  pixelStart = 0; //Temp variable for holding the current working framebuffer offset.
  //Variables used for scaling in JS:
  readonly width: number = GBWIDTH;
  readonly height: number = GBHEIGHT;
  readonly RGBCount: number = GBWIDTH * GBHEIGHT * 4;
  channel1FrequencyTracker = 0x2000;
  channel1DutyTracker = 0;
  channel1CachedDuty: boolean[];
  channel1totalLength = 0;
  channel1envelopeVolume = 0;
  channel1envelopeType = false;
  channel1envelopeSweeps = 0;
  channel1envelopeSweepsLast = 0;
  channel1consecutive = true;
  channel1frequency = 0;
  channel1SweepFault = false;
  channel1ShadowFrequency = 0;
  channel1timeSweep = 1;
  channel1lastTimeSweep = 0;
  channel1Swept = false;
  channel1frequencySweepDivider = 0;
  channel1decreaseSweep = false;
  channel2FrequencyTracker = 0x2000;
  channel2DutyTracker = 0;
  channel2CachedDuty: boolean[];
  channel2totalLength = 0;
  channel2envelopeVolume = 0;
  channel2envelopeType = false;
  channel2envelopeSweeps = 0;
  channel2envelopeSweepsLast = 0;
  channel2consecutive = true;
  channel2frequency = 0;
  channel3canPlay = false;
  channel3totalLength = 0;
  channel3patternType = 4;
  channel3frequency = 0;
  channel3consecutive = true;
  channel3Counter = 0x800;
  channel4FrequencyPeriod = 8;
  channel4totalLength = 0;
  channel4envelopeVolume = 0;
  channel4currentVolume = 0;
  channel4envelopeType = false;
  channel4envelopeSweeps = 0;
  channel4envelopeSweepsLast = 0;
  channel4consecutive = true;
  channel4BitRange = 0x7fff;
  channel4VolumeShifter = 15;
  channel1FrequencyCounter = 0x2000;
  channel2FrequencyCounter = 0x2000;
  channel3FrequencyPeriod = 0x800;
  channel3lastSampleLookup = 0;
  channel4lastSampleLookup = 0;
  sequencerClocks = 0x2000;
  sequencePosition = 0;
  channel4Counter = 8;
  cachedChannel3Sample = 0;
  cachedChannel4Sample = 0;
  channel1Enabled = false;
  channel2Enabled = false;
  channel3Enabled = false;
  channel4Enabled = false;
  channel1canPlay = false;
  channel2canPlay = false;
  channel4canPlay = false;
  ROMBankEdge: number;
  openRTC: (name: string) => any[];
  clocksPerSecond: number;
  openMBC: (name: string) => Uint8Array;
  audioResamplerFirstPassFactor: number;
  downSampleInputDivider: number;
  audioBuffer: Float32Array;
  sortBuffer: Uint8Array;
  OAMAddressCache: Int32Array;
  channel3envelopeVolume: number;

  constructor(ROMImage: Uint8Array, stringROM: string) {
    this.ROMImage = ROMImage;

    for (var index = 0x134; index < 0x13f; index++) {
      if (stringROM.charCodeAt(index) > 0) {
        this.name += stringROM.substring(index, index + 1);
      }
    }
    for (var index = 0x13f; index < 0x143; index++) {
      if (stringROM.charCodeAt(index) > 0) {
        this.gameCode += stringROM.substring(index, index + 1);
      }
    }

    this.initializeLCDController(); //Compile the LCD controller functions.
    this.initializeAudioStartState();

    this.initializeTiming();

    this.ROMBanks[0x52] = 72;
    this.ROMBanks[0x53] = 80;
    this.ROMBanks[0x54] = 96;

    this.updateGBBGPalette = this.updateGBRegularBGPalette;
    this.updateGBOBJPalette = this.updateGBRegularOBJPalette;

    //Initialize the white noise cache tables ahead of time:
    this.intializeWhiteNoise();
  }

  GBBOOTROM = [
    //GB BOOT ROM
    //Add 256 byte boot rom here if you are going to use it.
  ];

  GBCBOOTROM = [
    //GBC BOOT ROM
    //Add 2048 byte boot rom here if you are going to use it.
  ];

  ffxxDump = [
    //Dump of the post-BOOT I/O register state (From gambatte):
    0x0f,
    0x00,
    0x7c,
    0xff,
    0x00,
    0x00,
    0x00,
    0xf8,
    0xff,
    0xff,
    0xff,
    0xff,
    0xff,
    0xff,
    0xff,
    0x01,
    0x80,
    0xbf,
    0xf3,
    0xff,
    0xbf,
    0xff,
    0x3f,
    0x00,
    0xff,
    0xbf,
    0x7f,
    0xff,
    0x9f,
    0xff,
    0xbf,
    0xff,
    0xff,
    0x00,
    0x00,
    0xbf,
    0x77,
    0xf3,
    0xf1,
    0xff,
    0xff,
    0xff,
    0xff,
    0xff,
    0xff,
    0xff,
    0xff,
    0xff,
    0x00,
    0xff,
    0x00,
    0xff,
    0x00,
    0xff,
    0x00,
    0xff,
    0x00,
    0xff,
    0x00,
    0xff,
    0x00,
    0xff,
    0x00,
    0xff,
    0x91,
    0x80,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0xfc,
    0x00,
    0x00,
    0x00,
    0x00,
    0xff,
    0x7e,
    0xff,
    0xfe,
    0xff,
    0xff,
    0xff,
    0xff,
    0xff,
    0xff,
    0x3e,
    0xff,
    0xff,
    0xff,
    0xff,
    0xff,
    0xff,
    0xff,
    0xff,
    0xff,
    0xff,
    0xff,
    0xff,
    0xff,
    0xff,
    0xff,
    0xff,
    0xff,
    0xc0,
    0xff,
    0xc1,
    0x00,
    0xfe,
    0xff,
    0xff,
    0xff,
    0xf8,
    0xff,
    0x00,
    0x00,
    0x00,
    0x8f,
    0x00,
    0x00,
    0xff,
    0xff,
    0xff,
    0xff,
    0xff,
    0xff,
    0xff,
    0xff,
    0xce,
    0xed,
    0x66,
    0x66,
    0xcc,
    0x0d,
    0x00,
    0x0b,
    0x03,
    0x73,
    0x00,
    0x83,
    0x00,
    0x0c,
    0x00,
    0x0d,
    0x00,
    0x08,
    0x11,
    0x1f,
    0x88,
    0x89,
    0x00,
    0x0e,
    0xdc,
    0xcc,
    0x6e,
    0xe6,
    0xdd,
    0xdd,
    0xd9,
    0x99,
    0xbb,
    0xbb,
    0x67,
    0x63,
    0x6e,
    0x0e,
    0xec,
    0xcc,
    0xdd,
    0xdc,
    0x99,
    0x9f,
    0xbb,
    0xb9,
    0x33,
    0x3e,
    0x45,
    0xec,
    0x52,
    0xfa,
    0x08,
    0xb7,
    0x07,
    0x5d,
    0x01,
    0xfd,
    0xc0,
    0xff,
    0x08,
    0xfc,
    0x00,
    0xe5,
    0x0b,
    0xf8,
    0xc2,
    0xce,
    0xf4,
    0xf9,
    0x0f,
    0x7f,
    0x45,
    0x6d,
    0x3d,
    0xfe,
    0x46,
    0x97,
    0x33,
    0x5e,
    0x08,
    0xef,
    0xf1,
    0xff,
    0x86,
    0x83,
    0x24,
    0x74,
    0x12,
    0xfc,
    0x00,
    0x9f,
    0xb4,
    0xb7,
    0x06,
    0xd5,
    0xd0,
    0x7a,
    0x00,
    0x9e,
    0x04,
    0x5f,
    0x41,
    0x2f,
    0x1d,
    0x77,
    0x36,
    0x75,
    0x81,
    0xaa,
    0x70,
    0x3a,
    0x98,
    0xd1,
    0x71,
    0x02,
    0x4d,
    0x01,
    0xc1,
    0xff,
    0x0d,
    0x00,
    0xd3,
    0x05,
    0xf9,
    0x00,
    0x0b,
    0x00
  ];

  OPCODE = [
    //NOP
    //#0x00:
    function(parentObj: GameBoyCore) {
      //Do Nothing...
    },
    //LD BC, nn
    //#0x01:
    function(parentObj: GameBoyCore) {
      parentObj.registerC = parentObj.memoryReader[parentObj.programCounter](
        parentObj,
        parentObj.programCounter
      );
      parentObj.registerB = parentObj.memoryRead(
        (parentObj.programCounter + 1) & 0xffff
      );
      parentObj.programCounter = (parentObj.programCounter + 2) & 0xffff;
    },
    //LD (BC), A
    //#0x02:
    function(parentObj: GameBoyCore) {
      parentObj.memoryWrite(
        (parentObj.registerB << 8) | parentObj.registerC,
        parentObj.registerA
      );
    },
    //INC BC
    //#0x03:
    function(parentObj: GameBoyCore) {
      var temp_var = ((parentObj.registerB << 8) | parentObj.registerC) + 1;
      parentObj.registerB = (temp_var >> 8) & 0xff;
      parentObj.registerC = temp_var & 0xff;
    },
    //INC B
    //#0x04:
    function(parentObj: GameBoyCore) {
      parentObj.registerB = (parentObj.registerB + 1) & 0xff;
      parentObj.FZero = parentObj.registerB == 0;
      parentObj.FHalfCarry = (parentObj.registerB & 0xf) == 0;
      parentObj.FSubtract = false;
    },
    //DEC B
    //#0x05:
    function(parentObj: GameBoyCore) {
      parentObj.registerB = (parentObj.registerB - 1) & 0xff;
      parentObj.FZero = parentObj.registerB == 0;
      parentObj.FHalfCarry = (parentObj.registerB & 0xf) == 0xf;
      parentObj.FSubtract = true;
    },
    //LD B, n
    //#0x06:
    function(parentObj: GameBoyCore) {
      parentObj.registerB = parentObj.memoryReader[parentObj.programCounter](
        parentObj,
        parentObj.programCounter
      );
      parentObj.programCounter = (parentObj.programCounter + 1) & 0xffff;
    },
    //RLCA
    //#0x07:
    function(parentObj: GameBoyCore) {
      parentObj.FCarry = parentObj.registerA > 0x7f;
      parentObj.registerA =
        ((parentObj.registerA << 1) & 0xff) | (parentObj.registerA >> 7);
      parentObj.FZero = parentObj.FSubtract = parentObj.FHalfCarry = false;
    },
    //LD (nn), SP
    //#0x08:
    function(parentObj: GameBoyCore) {
      var temp_var =
        (parentObj.memoryRead((parentObj.programCounter + 1) & 0xffff) << 8) |
        parentObj.memoryReader[parentObj.programCounter](
          parentObj,
          parentObj.programCounter
        );
      parentObj.programCounter = (parentObj.programCounter + 2) & 0xffff;
      parentObj.memoryWrite(temp_var, parentObj.stackPointer & 0xff);
      parentObj.memoryWrite(
        (temp_var + 1) & 0xffff,
        parentObj.stackPointer >> 8
      );
    },
    //ADD HL, BC
    //#0x09:
    function(parentObj: GameBoyCore) {
      var dirtySum =
        parentObj.registersHL +
        ((parentObj.registerB << 8) | parentObj.registerC);
      parentObj.FHalfCarry =
        (parentObj.registersHL & 0xfff) > (dirtySum & 0xfff);
      parentObj.FCarry = dirtySum > 0xffff;
      parentObj.registersHL = dirtySum & 0xffff;
      parentObj.FSubtract = false;
    },
    //LD A, (BC)
    //#0x0A:
    function(parentObj: GameBoyCore) {
      parentObj.registerA = parentObj.memoryRead(
        (parentObj.registerB << 8) | parentObj.registerC
      );
    },
    //DEC BC
    //#0x0B:
    function(parentObj: GameBoyCore) {
      var temp_var =
        (((parentObj.registerB << 8) | parentObj.registerC) - 1) & 0xffff;
      parentObj.registerB = temp_var >> 8;
      parentObj.registerC = temp_var & 0xff;
    },
    //INC C
    //#0x0C:
    function(parentObj: GameBoyCore) {
      parentObj.registerC = (parentObj.registerC + 1) & 0xff;
      parentObj.FZero = parentObj.registerC == 0;
      parentObj.FHalfCarry = (parentObj.registerC & 0xf) == 0;
      parentObj.FSubtract = false;
    },
    //DEC C
    //#0x0D:
    function(parentObj: GameBoyCore) {
      parentObj.registerC = (parentObj.registerC - 1) & 0xff;
      parentObj.FZero = parentObj.registerC == 0;
      parentObj.FHalfCarry = (parentObj.registerC & 0xf) == 0xf;
      parentObj.FSubtract = true;
    },
    //LD C, n
    //#0x0E:
    function(parentObj: GameBoyCore) {
      parentObj.registerC = parentObj.memoryReader[parentObj.programCounter](
        parentObj,
        parentObj.programCounter
      );
      parentObj.programCounter = (parentObj.programCounter + 1) & 0xffff;
    },
    //RRCA
    //#0x0F:
    function(parentObj: GameBoyCore) {
      parentObj.registerA =
        (parentObj.registerA >> 1) | ((parentObj.registerA & 1) << 7);
      parentObj.FCarry = parentObj.registerA > 0x7f;
      parentObj.FZero = parentObj.FSubtract = parentObj.FHalfCarry = false;
    },
    //STOP
    //#0x10:
    function(parentObj: GameBoyCore) {
      if (parentObj.cGBC) {
        if ((parentObj.memory[0xff4d] & 0x01) == 0x01) {
          //Speed change requested.
          if (parentObj.memory[0xff4d] > 0x7f) {
            //Go back to single speed mode.
            cout("Going into single clock speed mode.", 0);
            parentObj.doubleSpeedShifter = 0;
            parentObj.memory[0xff4d] &= 0x7f; //Clear the double speed mode flag.
          } else {
            //Go to double speed mode.
            cout("Going into double clock speed mode.", 0);
            parentObj.doubleSpeedShifter = 1;
            parentObj.memory[0xff4d] |= 0x80; //Set the double speed mode flag.
          }
          parentObj.memory[0xff4d] &= 0xfe; //Reset the request bit.
        } else {
          parentObj.handleSTOP();
        }
      } else {
        parentObj.handleSTOP();
      }
    },
    //LD DE, nn
    //#0x11:
    function(parentObj: GameBoyCore) {
      parentObj.registerE = parentObj.memoryReader[parentObj.programCounter](
        parentObj,
        parentObj.programCounter
      );
      parentObj.registerD = parentObj.memoryRead(
        (parentObj.programCounter + 1) & 0xffff
      );
      parentObj.programCounter = (parentObj.programCounter + 2) & 0xffff;
    },
    //LD (DE), A
    //#0x12:
    function(parentObj: GameBoyCore) {
      parentObj.memoryWrite(
        (parentObj.registerD << 8) | parentObj.registerE,
        parentObj.registerA
      );
    },
    //INC DE
    //#0x13:
    function(parentObj: GameBoyCore) {
      var temp_var = ((parentObj.registerD << 8) | parentObj.registerE) + 1;
      parentObj.registerD = (temp_var >> 8) & 0xff;
      parentObj.registerE = temp_var & 0xff;
    },
    //INC D
    //#0x14:
    function(parentObj: GameBoyCore) {
      parentObj.registerD = (parentObj.registerD + 1) & 0xff;
      parentObj.FZero = parentObj.registerD == 0;
      parentObj.FHalfCarry = (parentObj.registerD & 0xf) == 0;
      parentObj.FSubtract = false;
    },
    //DEC D
    //#0x15:
    function(parentObj: GameBoyCore) {
      parentObj.registerD = (parentObj.registerD - 1) & 0xff;
      parentObj.FZero = parentObj.registerD == 0;
      parentObj.FHalfCarry = (parentObj.registerD & 0xf) == 0xf;
      parentObj.FSubtract = true;
    },
    //LD D, n
    //#0x16:
    function(parentObj: GameBoyCore) {
      parentObj.registerD = parentObj.memoryReader[parentObj.programCounter](
        parentObj,
        parentObj.programCounter
      );
      parentObj.programCounter = (parentObj.programCounter + 1) & 0xffff;
    },
    //RLA
    //#0x17:
    function(parentObj: GameBoyCore) {
      var carry_flag = parentObj.FCarry ? 1 : 0;
      parentObj.FCarry = parentObj.registerA > 0x7f;
      parentObj.registerA = ((parentObj.registerA << 1) & 0xff) | carry_flag;
      parentObj.FZero = parentObj.FSubtract = parentObj.FHalfCarry = false;
    },
    //JR n
    //#0x18:
    function(parentObj: GameBoyCore) {
      parentObj.programCounter =
        (parentObj.programCounter +
          ((parentObj.memoryReader[parentObj.programCounter](
            parentObj,
            parentObj.programCounter
          ) <<
            24) >>
            24) +
          1) &
        0xffff;
    },
    //ADD HL, DE
    //#0x19:
    function(parentObj: GameBoyCore) {
      var dirtySum =
        parentObj.registersHL +
        ((parentObj.registerD << 8) | parentObj.registerE);
      parentObj.FHalfCarry =
        (parentObj.registersHL & 0xfff) > (dirtySum & 0xfff);
      parentObj.FCarry = dirtySum > 0xffff;
      parentObj.registersHL = dirtySum & 0xffff;
      parentObj.FSubtract = false;
    },
    //LD A, (DE)
    //#0x1A:
    function(parentObj: GameBoyCore) {
      parentObj.registerA = parentObj.memoryRead(
        (parentObj.registerD << 8) | parentObj.registerE
      );
    },
    //DEC DE
    //#0x1B:
    function(parentObj: GameBoyCore) {
      var temp_var =
        (((parentObj.registerD << 8) | parentObj.registerE) - 1) & 0xffff;
      parentObj.registerD = temp_var >> 8;
      parentObj.registerE = temp_var & 0xff;
    },
    //INC E
    //#0x1C:
    function(parentObj: GameBoyCore) {
      parentObj.registerE = (parentObj.registerE + 1) & 0xff;
      parentObj.FZero = parentObj.registerE == 0;
      parentObj.FHalfCarry = (parentObj.registerE & 0xf) == 0;
      parentObj.FSubtract = false;
    },
    //DEC E
    //#0x1D:
    function(parentObj: GameBoyCore) {
      parentObj.registerE = (parentObj.registerE - 1) & 0xff;
      parentObj.FZero = parentObj.registerE == 0;
      parentObj.FHalfCarry = (parentObj.registerE & 0xf) == 0xf;
      parentObj.FSubtract = true;
    },
    //LD E, n
    //#0x1E:
    function(parentObj: GameBoyCore) {
      parentObj.registerE = parentObj.memoryReader[parentObj.programCounter](
        parentObj,
        parentObj.programCounter
      );
      parentObj.programCounter = (parentObj.programCounter + 1) & 0xffff;
    },
    //RRA
    //#0x1F:
    function(parentObj: GameBoyCore) {
      var carry_flag = parentObj.FCarry ? 0x80 : 0;
      parentObj.FCarry = (parentObj.registerA & 1) == 1;
      parentObj.registerA = (parentObj.registerA >> 1) | carry_flag;
      parentObj.FZero = parentObj.FSubtract = parentObj.FHalfCarry = false;
    },
    //JR NZ, n
    //#0x20:
    function(parentObj: GameBoyCore) {
      if (!parentObj.FZero) {
        parentObj.programCounter =
          (parentObj.programCounter +
            ((parentObj.memoryReader[parentObj.programCounter](
              parentObj,
              parentObj.programCounter
            ) <<
              24) >>
              24) +
            1) &
          0xffff;
        parentObj.CPUTicks += 4;
      } else {
        parentObj.programCounter = (parentObj.programCounter + 1) & 0xffff;
      }
    },
    //LD HL, nn
    //#0x21:
    function(parentObj: GameBoyCore) {
      parentObj.registersHL =
        (parentObj.memoryRead((parentObj.programCounter + 1) & 0xffff) << 8) |
        parentObj.memoryReader[parentObj.programCounter](
          parentObj,
          parentObj.programCounter
        );
      parentObj.programCounter = (parentObj.programCounter + 2) & 0xffff;
    },
    //LDI (HL), A
    //#0x22:
    function(parentObj: GameBoyCore) {
      parentObj.memoryWriter[parentObj.registersHL](
        parentObj,
        parentObj.registersHL,
        parentObj.registerA
      );
      parentObj.registersHL = (parentObj.registersHL + 1) & 0xffff;
    },
    //INC HL
    //#0x23:
    function(parentObj: GameBoyCore) {
      parentObj.registersHL = (parentObj.registersHL + 1) & 0xffff;
    },
    //INC H
    //#0x24:
    function(parentObj: GameBoyCore) {
      var H = ((parentObj.registersHL >> 8) + 1) & 0xff;
      parentObj.FZero = H == 0;
      parentObj.FHalfCarry = (H & 0xf) == 0;
      parentObj.FSubtract = false;
      parentObj.registersHL = (H << 8) | (parentObj.registersHL & 0xff);
    },
    //DEC H
    //#0x25:
    function(parentObj: GameBoyCore) {
      var H = ((parentObj.registersHL >> 8) - 1) & 0xff;
      parentObj.FZero = H == 0;
      parentObj.FHalfCarry = (H & 0xf) == 0xf;
      parentObj.FSubtract = true;
      parentObj.registersHL = (H << 8) | (parentObj.registersHL & 0xff);
    },
    //LD H, n
    //#0x26:
    function(parentObj: GameBoyCore) {
      parentObj.registersHL =
        (parentObj.memoryReader[parentObj.programCounter](
          parentObj,
          parentObj.programCounter
        ) <<
          8) |
        (parentObj.registersHL & 0xff);
      parentObj.programCounter = (parentObj.programCounter + 1) & 0xffff;
    },
    //DAA
    //#0x27:
    function(parentObj: GameBoyCore) {
      if (!parentObj.FSubtract) {
        if (parentObj.FCarry || parentObj.registerA > 0x99) {
          parentObj.registerA = (parentObj.registerA + 0x60) & 0xff;
          parentObj.FCarry = true;
        }
        if (parentObj.FHalfCarry || (parentObj.registerA & 0xf) > 0x9) {
          parentObj.registerA = (parentObj.registerA + 0x06) & 0xff;
          parentObj.FHalfCarry = false;
        }
      } else if (parentObj.FCarry && parentObj.FHalfCarry) {
        parentObj.registerA = (parentObj.registerA + 0x9a) & 0xff;
        parentObj.FHalfCarry = false;
      } else if (parentObj.FCarry) {
        parentObj.registerA = (parentObj.registerA + 0xa0) & 0xff;
      } else if (parentObj.FHalfCarry) {
        parentObj.registerA = (parentObj.registerA + 0xfa) & 0xff;
        parentObj.FHalfCarry = false;
      }
      parentObj.FZero = parentObj.registerA == 0;
    },
    //JR Z, n
    //#0x28:
    function(parentObj: GameBoyCore) {
      if (parentObj.FZero) {
        parentObj.programCounter =
          (parentObj.programCounter +
            ((parentObj.memoryReader[parentObj.programCounter](
              parentObj,
              parentObj.programCounter
            ) <<
              24) >>
              24) +
            1) &
          0xffff;
        parentObj.CPUTicks += 4;
      } else {
        parentObj.programCounter = (parentObj.programCounter + 1) & 0xffff;
      }
    },
    //ADD HL, HL
    //#0x29:
    function(parentObj: GameBoyCore) {
      parentObj.FHalfCarry = (parentObj.registersHL & 0xfff) > 0x7ff;
      parentObj.FCarry = parentObj.registersHL > 0x7fff;
      parentObj.registersHL = (parentObj.registersHL << 1) & 0xffff;
      parentObj.FSubtract = false;
    },
    //LDI A, (HL)
    //#0x2A:
    function(parentObj: GameBoyCore) {
      parentObj.registerA = parentObj.memoryReader[parentObj.registersHL](
        parentObj,
        parentObj.registersHL
      );
      parentObj.registersHL = (parentObj.registersHL + 1) & 0xffff;
    },
    //DEC HL
    //#0x2B:
    function(parentObj: GameBoyCore) {
      parentObj.registersHL = (parentObj.registersHL - 1) & 0xffff;
    },
    //INC L
    //#0x2C:
    function(parentObj: GameBoyCore) {
      var L = (parentObj.registersHL + 1) & 0xff;
      parentObj.FZero = L == 0;
      parentObj.FHalfCarry = (L & 0xf) == 0;
      parentObj.FSubtract = false;
      parentObj.registersHL = (parentObj.registersHL & 0xff00) | L;
    },
    //DEC L
    //#0x2D:
    function(parentObj: GameBoyCore) {
      var L = (parentObj.registersHL - 1) & 0xff;
      parentObj.FZero = L == 0;
      parentObj.FHalfCarry = (L & 0xf) == 0xf;
      parentObj.FSubtract = true;
      parentObj.registersHL = (parentObj.registersHL & 0xff00) | L;
    },
    //LD L, n
    //#0x2E:
    function(parentObj: GameBoyCore) {
      parentObj.registersHL =
        (parentObj.registersHL & 0xff00) |
        parentObj.memoryReader[parentObj.programCounter](
          parentObj,
          parentObj.programCounter
        );
      parentObj.programCounter = (parentObj.programCounter + 1) & 0xffff;
    },
    //CPL
    //#0x2F:
    function(parentObj: GameBoyCore) {
      parentObj.registerA ^= 0xff;
      parentObj.FSubtract = parentObj.FHalfCarry = true;
    },
    //JR NC, n
    //#0x30:
    function(parentObj: GameBoyCore) {
      if (!parentObj.FCarry) {
        parentObj.programCounter =
          (parentObj.programCounter +
            ((parentObj.memoryReader[parentObj.programCounter](
              parentObj,
              parentObj.programCounter
            ) <<
              24) >>
              24) +
            1) &
          0xffff;
        parentObj.CPUTicks += 4;
      } else {
        parentObj.programCounter = (parentObj.programCounter + 1) & 0xffff;
      }
    },
    //LD SP, nn
    //#0x31:
    function(parentObj: GameBoyCore) {
      parentObj.stackPointer =
        (parentObj.memoryRead((parentObj.programCounter + 1) & 0xffff) << 8) |
        parentObj.memoryReader[parentObj.programCounter](
          parentObj,
          parentObj.programCounter
        );
      parentObj.programCounter = (parentObj.programCounter + 2) & 0xffff;
    },
    //LDD (HL), A
    //#0x32:
    function(parentObj: GameBoyCore) {
      parentObj.memoryWriter[parentObj.registersHL](
        parentObj,
        parentObj.registersHL,
        parentObj.registerA
      );
      parentObj.registersHL = (parentObj.registersHL - 1) & 0xffff;
    },
    //INC SP
    //#0x33:
    function(parentObj: GameBoyCore) {
      parentObj.stackPointer = (parentObj.stackPointer + 1) & 0xffff;
    },
    //INC (HL)
    //#0x34:
    function(parentObj: GameBoyCore) {
      var temp_var =
        (parentObj.memoryReader[parentObj.registersHL](
          parentObj,
          parentObj.registersHL
        ) +
          1) &
        0xff;
      parentObj.FZero = temp_var == 0;
      parentObj.FHalfCarry = (temp_var & 0xf) == 0;
      parentObj.FSubtract = false;
      parentObj.memoryWriter[parentObj.registersHL](
        parentObj,
        parentObj.registersHL,
        temp_var
      );
    },
    //DEC (HL)
    //#0x35:
    function(parentObj: GameBoyCore) {
      var temp_var =
        (parentObj.memoryReader[parentObj.registersHL](
          parentObj,
          parentObj.registersHL
        ) -
          1) &
        0xff;
      parentObj.FZero = temp_var == 0;
      parentObj.FHalfCarry = (temp_var & 0xf) == 0xf;
      parentObj.FSubtract = true;
      parentObj.memoryWriter[parentObj.registersHL](
        parentObj,
        parentObj.registersHL,
        temp_var
      );
    },
    //LD (HL), n
    //#0x36:
    function(parentObj: GameBoyCore) {
      parentObj.memoryWriter[parentObj.registersHL](
        parentObj,
        parentObj.registersHL,
        parentObj.memoryReader[parentObj.programCounter](
          parentObj,
          parentObj.programCounter
        )
      );
      parentObj.programCounter = (parentObj.programCounter + 1) & 0xffff;
    },
    //SCF
    //#0x37:
    function(parentObj: GameBoyCore) {
      parentObj.FCarry = true;
      parentObj.FSubtract = parentObj.FHalfCarry = false;
    },
    //JR C, n
    //#0x38:
    function(parentObj: GameBoyCore) {
      if (parentObj.FCarry) {
        parentObj.programCounter =
          (parentObj.programCounter +
            ((parentObj.memoryReader[parentObj.programCounter](
              parentObj,
              parentObj.programCounter
            ) <<
              24) >>
              24) +
            1) &
          0xffff;
        parentObj.CPUTicks += 4;
      } else {
        parentObj.programCounter = (parentObj.programCounter + 1) & 0xffff;
      }
    },
    //ADD HL, SP
    //#0x39:
    function(parentObj: GameBoyCore) {
      var dirtySum = parentObj.registersHL + parentObj.stackPointer;
      parentObj.FHalfCarry =
        (parentObj.registersHL & 0xfff) > (dirtySum & 0xfff);
      parentObj.FCarry = dirtySum > 0xffff;
      parentObj.registersHL = dirtySum & 0xffff;
      parentObj.FSubtract = false;
    },
    //LDD A, (HL)
    //#0x3A:
    function(parentObj: GameBoyCore) {
      parentObj.registerA = parentObj.memoryReader[parentObj.registersHL](
        parentObj,
        parentObj.registersHL
      );
      parentObj.registersHL = (parentObj.registersHL - 1) & 0xffff;
    },
    //DEC SP
    //#0x3B:
    function(parentObj: GameBoyCore) {
      parentObj.stackPointer = (parentObj.stackPointer - 1) & 0xffff;
    },
    //INC A
    //#0x3C:
    function(parentObj: GameBoyCore) {
      parentObj.registerA = (parentObj.registerA + 1) & 0xff;
      parentObj.FZero = parentObj.registerA == 0;
      parentObj.FHalfCarry = (parentObj.registerA & 0xf) == 0;
      parentObj.FSubtract = false;
    },
    //DEC A
    //#0x3D:
    function(parentObj: GameBoyCore) {
      parentObj.registerA = (parentObj.registerA - 1) & 0xff;
      parentObj.FZero = parentObj.registerA == 0;
      parentObj.FHalfCarry = (parentObj.registerA & 0xf) == 0xf;
      parentObj.FSubtract = true;
    },
    //LD A, n
    //#0x3E:
    function(parentObj: GameBoyCore) {
      parentObj.registerA = parentObj.memoryReader[parentObj.programCounter](
        parentObj,
        parentObj.programCounter
      );
      parentObj.programCounter = (parentObj.programCounter + 1) & 0xffff;
    },
    //CCF
    //#0x3F:
    function(parentObj: GameBoyCore) {
      parentObj.FCarry = !parentObj.FCarry;
      parentObj.FSubtract = parentObj.FHalfCarry = false;
    },
    //LD B, B
    //#0x40:
    function(parentObj: GameBoyCore) {
      //Do nothing...
    },
    //LD B, C
    //#0x41:
    function(parentObj: GameBoyCore) {
      parentObj.registerB = parentObj.registerC;
    },
    //LD B, D
    //#0x42:
    function(parentObj: GameBoyCore) {
      parentObj.registerB = parentObj.registerD;
    },
    //LD B, E
    //#0x43:
    function(parentObj: GameBoyCore) {
      parentObj.registerB = parentObj.registerE;
    },
    //LD B, H
    //#0x44:
    function(parentObj: GameBoyCore) {
      parentObj.registerB = parentObj.registersHL >> 8;
    },
    //LD B, L
    //#0x45:
    function(parentObj: GameBoyCore) {
      parentObj.registerB = parentObj.registersHL & 0xff;
    },
    //LD B, (HL)
    //#0x46:
    function(parentObj: GameBoyCore) {
      parentObj.registerB = parentObj.memoryReader[parentObj.registersHL](
        parentObj,
        parentObj.registersHL
      );
    },
    //LD B, A
    //#0x47:
    function(parentObj: GameBoyCore) {
      parentObj.registerB = parentObj.registerA;
    },
    //LD C, B
    //#0x48:
    function(parentObj: GameBoyCore) {
      parentObj.registerC = parentObj.registerB;
    },
    //LD C, C
    //#0x49:
    function(parentObj: GameBoyCore) {
      //Do nothing...
    },
    //LD C, D
    //#0x4A:
    function(parentObj: GameBoyCore) {
      parentObj.registerC = parentObj.registerD;
    },
    //LD C, E
    //#0x4B:
    function(parentObj: GameBoyCore) {
      parentObj.registerC = parentObj.registerE;
    },
    //LD C, H
    //#0x4C:
    function(parentObj: GameBoyCore) {
      parentObj.registerC = parentObj.registersHL >> 8;
    },
    //LD C, L
    //#0x4D:
    function(parentObj: GameBoyCore) {
      parentObj.registerC = parentObj.registersHL & 0xff;
    },
    //LD C, (HL)
    //#0x4E:
    function(parentObj: GameBoyCore) {
      parentObj.registerC = parentObj.memoryReader[parentObj.registersHL](
        parentObj,
        parentObj.registersHL
      );
    },
    //LD C, A
    //#0x4F:
    function(parentObj: GameBoyCore) {
      parentObj.registerC = parentObj.registerA;
    },
    //LD D, B
    //#0x50:
    function(parentObj: GameBoyCore) {
      parentObj.registerD = parentObj.registerB;
    },
    //LD D, C
    //#0x51:
    function(parentObj: GameBoyCore) {
      parentObj.registerD = parentObj.registerC;
    },
    //LD D, D
    //#0x52:
    function(parentObj: GameBoyCore) {
      //Do nothing...
    },
    //LD D, E
    //#0x53:
    function(parentObj: GameBoyCore) {
      parentObj.registerD = parentObj.registerE;
    },
    //LD D, H
    //#0x54:
    function(parentObj: GameBoyCore) {
      parentObj.registerD = parentObj.registersHL >> 8;
    },
    //LD D, L
    //#0x55:
    function(parentObj: GameBoyCore) {
      parentObj.registerD = parentObj.registersHL & 0xff;
    },
    //LD D, (HL)
    //#0x56:
    function(parentObj: GameBoyCore) {
      parentObj.registerD = parentObj.memoryReader[parentObj.registersHL](
        parentObj,
        parentObj.registersHL
      );
    },
    //LD D, A
    //#0x57:
    function(parentObj: GameBoyCore) {
      parentObj.registerD = parentObj.registerA;
    },
    //LD E, B
    //#0x58:
    function(parentObj: GameBoyCore) {
      parentObj.registerE = parentObj.registerB;
    },
    //LD E, C
    //#0x59:
    function(parentObj: GameBoyCore) {
      parentObj.registerE = parentObj.registerC;
    },
    //LD E, D
    //#0x5A:
    function(parentObj: GameBoyCore) {
      parentObj.registerE = parentObj.registerD;
    },
    //LD E, E
    //#0x5B:
    function(parentObj: GameBoyCore) {
      //Do nothing...
    },
    //LD E, H
    //#0x5C:
    function(parentObj: GameBoyCore) {
      parentObj.registerE = parentObj.registersHL >> 8;
    },
    //LD E, L
    //#0x5D:
    function(parentObj: GameBoyCore) {
      parentObj.registerE = parentObj.registersHL & 0xff;
    },
    //LD E, (HL)
    //#0x5E:
    function(parentObj: GameBoyCore) {
      parentObj.registerE = parentObj.memoryReader[parentObj.registersHL](
        parentObj,
        parentObj.registersHL
      );
    },
    //LD E, A
    //#0x5F:
    function(parentObj: GameBoyCore) {
      parentObj.registerE = parentObj.registerA;
    },
    //LD H, B
    //#0x60:
    function(parentObj: GameBoyCore) {
      parentObj.registersHL =
        (parentObj.registerB << 8) | (parentObj.registersHL & 0xff);
    },
    //LD H, C
    //#0x61:
    function(parentObj: GameBoyCore) {
      parentObj.registersHL =
        (parentObj.registerC << 8) | (parentObj.registersHL & 0xff);
    },
    //LD H, D
    //#0x62:
    function(parentObj: GameBoyCore) {
      parentObj.registersHL =
        (parentObj.registerD << 8) | (parentObj.registersHL & 0xff);
    },
    //LD H, E
    //#0x63:
    function(parentObj: GameBoyCore) {
      parentObj.registersHL =
        (parentObj.registerE << 8) | (parentObj.registersHL & 0xff);
    },
    //LD H, H
    //#0x64:
    function(parentObj: GameBoyCore) {
      //Do nothing...
    },
    //LD H, L
    //#0x65:
    function(parentObj: GameBoyCore) {
      parentObj.registersHL = (parentObj.registersHL & 0xff) * 0x101;
    },
    //LD H, (HL)
    //#0x66:
    function(parentObj: GameBoyCore) {
      parentObj.registersHL =
        (parentObj.memoryReader[parentObj.registersHL](
          parentObj,
          parentObj.registersHL
        ) <<
          8) |
        (parentObj.registersHL & 0xff);
    },
    //LD H, A
    //#0x67:
    function(parentObj: GameBoyCore) {
      parentObj.registersHL =
        (parentObj.registerA << 8) | (parentObj.registersHL & 0xff);
    },
    //LD L, B
    //#0x68:
    function(parentObj: GameBoyCore) {
      parentObj.registersHL =
        (parentObj.registersHL & 0xff00) | parentObj.registerB;
    },
    //LD L, C
    //#0x69:
    function(parentObj: GameBoyCore) {
      parentObj.registersHL =
        (parentObj.registersHL & 0xff00) | parentObj.registerC;
    },
    //LD L, D
    //#0x6A:
    function(parentObj: GameBoyCore) {
      parentObj.registersHL =
        (parentObj.registersHL & 0xff00) | parentObj.registerD;
    },
    //LD L, E
    //#0x6B:
    function(parentObj: GameBoyCore) {
      parentObj.registersHL =
        (parentObj.registersHL & 0xff00) | parentObj.registerE;
    },
    //LD L, H
    //#0x6C:
    function(parentObj: GameBoyCore) {
      parentObj.registersHL =
        (parentObj.registersHL & 0xff00) | (parentObj.registersHL >> 8);
    },
    //LD L, L
    //#0x6D:
    function(parentObj: GameBoyCore) {
      //Do nothing...
    },
    //LD L, (HL)
    //#0x6E:
    function(parentObj: GameBoyCore) {
      parentObj.registersHL =
        (parentObj.registersHL & 0xff00) |
        parentObj.memoryReader[parentObj.registersHL](
          parentObj,
          parentObj.registersHL
        );
    },
    //LD L, A
    //#0x6F:
    function(parentObj: GameBoyCore) {
      parentObj.registersHL =
        (parentObj.registersHL & 0xff00) | parentObj.registerA;
    },
    //LD (HL), B
    //#0x70:
    function(parentObj: GameBoyCore) {
      parentObj.memoryWriter[parentObj.registersHL](
        parentObj,
        parentObj.registersHL,
        parentObj.registerB
      );
    },
    //LD (HL), C
    //#0x71:
    function(parentObj: GameBoyCore) {
      parentObj.memoryWriter[parentObj.registersHL](
        parentObj,
        parentObj.registersHL,
        parentObj.registerC
      );
    },
    //LD (HL), D
    //#0x72:
    function(parentObj: GameBoyCore) {
      parentObj.memoryWriter[parentObj.registersHL](
        parentObj,
        parentObj.registersHL,
        parentObj.registerD
      );
    },
    //LD (HL), E
    //#0x73:
    function(parentObj: GameBoyCore) {
      parentObj.memoryWriter[parentObj.registersHL](
        parentObj,
        parentObj.registersHL,
        parentObj.registerE
      );
    },
    //LD (HL), H
    //#0x74:
    function(parentObj: GameBoyCore) {
      parentObj.memoryWriter[parentObj.registersHL](
        parentObj,
        parentObj.registersHL,
        parentObj.registersHL >> 8
      );
    },
    //LD (HL), L
    //#0x75:
    function(parentObj: GameBoyCore) {
      parentObj.memoryWriter[parentObj.registersHL](
        parentObj,
        parentObj.registersHL,
        parentObj.registersHL & 0xff
      );
    },
    //HALT
    //#0x76:
    function(parentObj: GameBoyCore) {
      //See if there's already an IRQ match:
      if (
        (parentObj.interruptsEnabled & parentObj.interruptsRequested & 0x1f) >
        0
      ) {
        if (!parentObj.cGBC && !parentObj.usedBootROM) {
          //HALT bug in the DMG CPU model (Program Counter fails to increment for one instruction after HALT):
          parentObj.skipPCIncrement = true;
        } else {
          //CGB gets around the HALT PC bug by doubling the hidden NOP.
          parentObj.CPUTicks += 4;
        }
      } else {
        //CPU is stalled until the next IRQ match:
        parentObj.calculateHALTPeriod();
      }
    },
    //LD (HL), A
    //#0x77:
    function(parentObj: GameBoyCore) {
      parentObj.memoryWriter[parentObj.registersHL](
        parentObj,
        parentObj.registersHL,
        parentObj.registerA
      );
    },
    //LD A, B
    //#0x78:
    function(parentObj: GameBoyCore) {
      parentObj.registerA = parentObj.registerB;
    },
    //LD A, C
    //#0x79:
    function(parentObj: GameBoyCore) {
      parentObj.registerA = parentObj.registerC;
    },
    //LD A, D
    //#0x7A:
    function(parentObj: GameBoyCore) {
      parentObj.registerA = parentObj.registerD;
    },
    //LD A, E
    //#0x7B:
    function(parentObj: GameBoyCore) {
      parentObj.registerA = parentObj.registerE;
    },
    //LD A, H
    //#0x7C:
    function(parentObj: GameBoyCore) {
      parentObj.registerA = parentObj.registersHL >> 8;
    },
    //LD A, L
    //#0x7D:
    function(parentObj: GameBoyCore) {
      parentObj.registerA = parentObj.registersHL & 0xff;
    },
    //LD, A, (HL)
    //#0x7E:
    function(parentObj: GameBoyCore) {
      parentObj.registerA = parentObj.memoryReader[parentObj.registersHL](
        parentObj,
        parentObj.registersHL
      );
    },
    //LD A, A
    //#0x7F:
    function(parentObj: GameBoyCore) {
      //Do Nothing...
    },
    //ADD A, B
    //#0x80:
    function(parentObj: GameBoyCore) {
      var dirtySum = parentObj.registerA + parentObj.registerB;
      parentObj.FHalfCarry = (dirtySum & 0xf) < (parentObj.registerA & 0xf);
      parentObj.FCarry = dirtySum > 0xff;
      parentObj.registerA = dirtySum & 0xff;
      parentObj.FZero = parentObj.registerA == 0;
      parentObj.FSubtract = false;
    },
    //ADD A, C
    //#0x81:
    function(parentObj: GameBoyCore) {
      var dirtySum = parentObj.registerA + parentObj.registerC;
      parentObj.FHalfCarry = (dirtySum & 0xf) < (parentObj.registerA & 0xf);
      parentObj.FCarry = dirtySum > 0xff;
      parentObj.registerA = dirtySum & 0xff;
      parentObj.FZero = parentObj.registerA == 0;
      parentObj.FSubtract = false;
    },
    //ADD A, D
    //#0x82:
    function(parentObj: GameBoyCore) {
      var dirtySum = parentObj.registerA + parentObj.registerD;
      parentObj.FHalfCarry = (dirtySum & 0xf) < (parentObj.registerA & 0xf);
      parentObj.FCarry = dirtySum > 0xff;
      parentObj.registerA = dirtySum & 0xff;
      parentObj.FZero = parentObj.registerA == 0;
      parentObj.FSubtract = false;
    },
    //ADD A, E
    //#0x83:
    function(parentObj: GameBoyCore) {
      var dirtySum = parentObj.registerA + parentObj.registerE;
      parentObj.FHalfCarry = (dirtySum & 0xf) < (parentObj.registerA & 0xf);
      parentObj.FCarry = dirtySum > 0xff;
      parentObj.registerA = dirtySum & 0xff;
      parentObj.FZero = parentObj.registerA == 0;
      parentObj.FSubtract = false;
    },
    //ADD A, H
    //#0x84:
    function(parentObj: GameBoyCore) {
      var dirtySum = parentObj.registerA + (parentObj.registersHL >> 8);
      parentObj.FHalfCarry = (dirtySum & 0xf) < (parentObj.registerA & 0xf);
      parentObj.FCarry = dirtySum > 0xff;
      parentObj.registerA = dirtySum & 0xff;
      parentObj.FZero = parentObj.registerA == 0;
      parentObj.FSubtract = false;
    },
    //ADD A, L
    //#0x85:
    function(parentObj: GameBoyCore) {
      var dirtySum = parentObj.registerA + (parentObj.registersHL & 0xff);
      parentObj.FHalfCarry = (dirtySum & 0xf) < (parentObj.registerA & 0xf);
      parentObj.FCarry = dirtySum > 0xff;
      parentObj.registerA = dirtySum & 0xff;
      parentObj.FZero = parentObj.registerA == 0;
      parentObj.FSubtract = false;
    },
    //ADD A, (HL)
    //#0x86:
    function(parentObj: GameBoyCore) {
      var dirtySum =
        parentObj.registerA +
        parentObj.memoryReader[parentObj.registersHL](
          parentObj,
          parentObj.registersHL
        );
      parentObj.FHalfCarry = (dirtySum & 0xf) < (parentObj.registerA & 0xf);
      parentObj.FCarry = dirtySum > 0xff;
      parentObj.registerA = dirtySum & 0xff;
      parentObj.FZero = parentObj.registerA == 0;
      parentObj.FSubtract = false;
    },
    //ADD A, A
    //#0x87:
    function(parentObj: GameBoyCore) {
      parentObj.FHalfCarry = (parentObj.registerA & 0x8) == 0x8;
      parentObj.FCarry = parentObj.registerA > 0x7f;
      parentObj.registerA = (parentObj.registerA << 1) & 0xff;
      parentObj.FZero = parentObj.registerA == 0;
      parentObj.FSubtract = false;
    },
    //ADC A, B
    //#0x88:
    function(parentObj: GameBoyCore) {
      var dirtySum =
        parentObj.registerA + parentObj.registerB + (parentObj.FCarry ? 1 : 0);
      parentObj.FHalfCarry =
        (parentObj.registerA & 0xf) +
          (parentObj.registerB & 0xf) +
          (parentObj.FCarry ? 1 : 0) >
        0xf;
      parentObj.FCarry = dirtySum > 0xff;
      parentObj.registerA = dirtySum & 0xff;
      parentObj.FZero = parentObj.registerA == 0;
      parentObj.FSubtract = false;
    },
    //ADC A, C
    //#0x89:
    function(parentObj: GameBoyCore) {
      var dirtySum =
        parentObj.registerA + parentObj.registerC + (parentObj.FCarry ? 1 : 0);
      parentObj.FHalfCarry =
        (parentObj.registerA & 0xf) +
          (parentObj.registerC & 0xf) +
          (parentObj.FCarry ? 1 : 0) >
        0xf;
      parentObj.FCarry = dirtySum > 0xff;
      parentObj.registerA = dirtySum & 0xff;
      parentObj.FZero = parentObj.registerA == 0;
      parentObj.FSubtract = false;
    },
    //ADC A, D
    //#0x8A:
    function(parentObj: GameBoyCore) {
      var dirtySum =
        parentObj.registerA + parentObj.registerD + (parentObj.FCarry ? 1 : 0);
      parentObj.FHalfCarry =
        (parentObj.registerA & 0xf) +
          (parentObj.registerD & 0xf) +
          (parentObj.FCarry ? 1 : 0) >
        0xf;
      parentObj.FCarry = dirtySum > 0xff;
      parentObj.registerA = dirtySum & 0xff;
      parentObj.FZero = parentObj.registerA == 0;
      parentObj.FSubtract = false;
    },
    //ADC A, E
    //#0x8B:
    function(parentObj: GameBoyCore) {
      var dirtySum =
        parentObj.registerA + parentObj.registerE + (parentObj.FCarry ? 1 : 0);
      parentObj.FHalfCarry =
        (parentObj.registerA & 0xf) +
          (parentObj.registerE & 0xf) +
          (parentObj.FCarry ? 1 : 0) >
        0xf;
      parentObj.FCarry = dirtySum > 0xff;
      parentObj.registerA = dirtySum & 0xff;
      parentObj.FZero = parentObj.registerA == 0;
      parentObj.FSubtract = false;
    },
    //ADC A, H
    //#0x8C:
    function(parentObj: GameBoyCore) {
      var tempValue = parentObj.registersHL >> 8;
      var dirtySum =
        parentObj.registerA + tempValue + (parentObj.FCarry ? 1 : 0);
      parentObj.FHalfCarry =
        (parentObj.registerA & 0xf) +
          (tempValue & 0xf) +
          (parentObj.FCarry ? 1 : 0) >
        0xf;
      parentObj.FCarry = dirtySum > 0xff;
      parentObj.registerA = dirtySum & 0xff;
      parentObj.FZero = parentObj.registerA == 0;
      parentObj.FSubtract = false;
    },
    //ADC A, L
    //#0x8D:
    function(parentObj: GameBoyCore) {
      var tempValue = parentObj.registersHL & 0xff;
      var dirtySum =
        parentObj.registerA + tempValue + (parentObj.FCarry ? 1 : 0);
      parentObj.FHalfCarry =
        (parentObj.registerA & 0xf) +
          (tempValue & 0xf) +
          (parentObj.FCarry ? 1 : 0) >
        0xf;
      parentObj.FCarry = dirtySum > 0xff;
      parentObj.registerA = dirtySum & 0xff;
      parentObj.FZero = parentObj.registerA == 0;
      parentObj.FSubtract = false;
    },
    //ADC A, (HL)
    //#0x8E:
    function(parentObj: GameBoyCore) {
      var tempValue = parentObj.memoryReader[parentObj.registersHL](
        parentObj,
        parentObj.registersHL
      );
      var dirtySum =
        parentObj.registerA + tempValue + (parentObj.FCarry ? 1 : 0);
      parentObj.FHalfCarry =
        (parentObj.registerA & 0xf) +
          (tempValue & 0xf) +
          (parentObj.FCarry ? 1 : 0) >
        0xf;
      parentObj.FCarry = dirtySum > 0xff;
      parentObj.registerA = dirtySum & 0xff;
      parentObj.FZero = parentObj.registerA == 0;
      parentObj.FSubtract = false;
    },
    //ADC A, A
    //#0x8F:
    function(parentObj: GameBoyCore) {
      //shift left register A one bit for some ops here as an optimization:
      var dirtySum = (parentObj.registerA << 1) | (parentObj.FCarry ? 1 : 0);
      parentObj.FHalfCarry =
        (((parentObj.registerA << 1) & 0x1e) | (parentObj.FCarry ? 1 : 0)) >
        0xf;
      parentObj.FCarry = dirtySum > 0xff;
      parentObj.registerA = dirtySum & 0xff;
      parentObj.FZero = parentObj.registerA == 0;
      parentObj.FSubtract = false;
    },
    //SUB A, B
    //#0x90:
    function(parentObj: GameBoyCore) {
      var dirtySum = parentObj.registerA - parentObj.registerB;
      parentObj.FHalfCarry = (parentObj.registerA & 0xf) < (dirtySum & 0xf);
      parentObj.FCarry = dirtySum < 0;
      parentObj.registerA = dirtySum & 0xff;
      parentObj.FZero = dirtySum == 0;
      parentObj.FSubtract = true;
    },
    //SUB A, C
    //#0x91:
    function(parentObj: GameBoyCore) {
      var dirtySum = parentObj.registerA - parentObj.registerC;
      parentObj.FHalfCarry = (parentObj.registerA & 0xf) < (dirtySum & 0xf);
      parentObj.FCarry = dirtySum < 0;
      parentObj.registerA = dirtySum & 0xff;
      parentObj.FZero = dirtySum == 0;
      parentObj.FSubtract = true;
    },
    //SUB A, D
    //#0x92:
    function(parentObj: GameBoyCore) {
      var dirtySum = parentObj.registerA - parentObj.registerD;
      parentObj.FHalfCarry = (parentObj.registerA & 0xf) < (dirtySum & 0xf);
      parentObj.FCarry = dirtySum < 0;
      parentObj.registerA = dirtySum & 0xff;
      parentObj.FZero = dirtySum == 0;
      parentObj.FSubtract = true;
    },
    //SUB A, E
    //#0x93:
    function(parentObj: GameBoyCore) {
      var dirtySum = parentObj.registerA - parentObj.registerE;
      parentObj.FHalfCarry = (parentObj.registerA & 0xf) < (dirtySum & 0xf);
      parentObj.FCarry = dirtySum < 0;
      parentObj.registerA = dirtySum & 0xff;
      parentObj.FZero = dirtySum == 0;
      parentObj.FSubtract = true;
    },
    //SUB A, H
    //#0x94:
    function(parentObj: GameBoyCore) {
      var dirtySum = parentObj.registerA - (parentObj.registersHL >> 8);
      parentObj.FHalfCarry = (parentObj.registerA & 0xf) < (dirtySum & 0xf);
      parentObj.FCarry = dirtySum < 0;
      parentObj.registerA = dirtySum & 0xff;
      parentObj.FZero = dirtySum == 0;
      parentObj.FSubtract = true;
    },
    //SUB A, L
    //#0x95:
    function(parentObj: GameBoyCore) {
      var dirtySum = parentObj.registerA - (parentObj.registersHL & 0xff);
      parentObj.FHalfCarry = (parentObj.registerA & 0xf) < (dirtySum & 0xf);
      parentObj.FCarry = dirtySum < 0;
      parentObj.registerA = dirtySum & 0xff;
      parentObj.FZero = dirtySum == 0;
      parentObj.FSubtract = true;
    },
    //SUB A, (HL)
    //#0x96:
    function(parentObj: GameBoyCore) {
      var dirtySum =
        parentObj.registerA -
        parentObj.memoryReader[parentObj.registersHL](
          parentObj,
          parentObj.registersHL
        );
      parentObj.FHalfCarry = (parentObj.registerA & 0xf) < (dirtySum & 0xf);
      parentObj.FCarry = dirtySum < 0;
      parentObj.registerA = dirtySum & 0xff;
      parentObj.FZero = dirtySum == 0;
      parentObj.FSubtract = true;
    },
    //SUB A, A
    //#0x97:
    function(parentObj: GameBoyCore) {
      //number - same number == 0
      parentObj.registerA = 0;
      parentObj.FHalfCarry = parentObj.FCarry = false;
      parentObj.FZero = parentObj.FSubtract = true;
    },
    //SBC A, B
    //#0x98:
    function(parentObj: GameBoyCore) {
      var dirtySum =
        parentObj.registerA - parentObj.registerB - (parentObj.FCarry ? 1 : 0);
      parentObj.FHalfCarry =
        (parentObj.registerA & 0xf) -
          (parentObj.registerB & 0xf) -
          (parentObj.FCarry ? 1 : 0) <
        0;
      parentObj.FCarry = dirtySum < 0;
      parentObj.registerA = dirtySum & 0xff;
      parentObj.FZero = parentObj.registerA == 0;
      parentObj.FSubtract = true;
    },
    //SBC A, C
    //#0x99:
    function(parentObj: GameBoyCore) {
      var dirtySum =
        parentObj.registerA - parentObj.registerC - (parentObj.FCarry ? 1 : 0);
      parentObj.FHalfCarry =
        (parentObj.registerA & 0xf) -
          (parentObj.registerC & 0xf) -
          (parentObj.FCarry ? 1 : 0) <
        0;
      parentObj.FCarry = dirtySum < 0;
      parentObj.registerA = dirtySum & 0xff;
      parentObj.FZero = parentObj.registerA == 0;
      parentObj.FSubtract = true;
    },
    //SBC A, D
    //#0x9A:
    function(parentObj: GameBoyCore) {
      var dirtySum =
        parentObj.registerA - parentObj.registerD - (parentObj.FCarry ? 1 : 0);
      parentObj.FHalfCarry =
        (parentObj.registerA & 0xf) -
          (parentObj.registerD & 0xf) -
          (parentObj.FCarry ? 1 : 0) <
        0;
      parentObj.FCarry = dirtySum < 0;
      parentObj.registerA = dirtySum & 0xff;
      parentObj.FZero = parentObj.registerA == 0;
      parentObj.FSubtract = true;
    },
    //SBC A, E
    //#0x9B:
    function(parentObj: GameBoyCore) {
      var dirtySum =
        parentObj.registerA - parentObj.registerE - (parentObj.FCarry ? 1 : 0);
      parentObj.FHalfCarry =
        (parentObj.registerA & 0xf) -
          (parentObj.registerE & 0xf) -
          (parentObj.FCarry ? 1 : 0) <
        0;
      parentObj.FCarry = dirtySum < 0;
      parentObj.registerA = dirtySum & 0xff;
      parentObj.FZero = parentObj.registerA == 0;
      parentObj.FSubtract = true;
    },
    //SBC A, H
    //#0x9C:
    function(parentObj: GameBoyCore) {
      var temp_var = parentObj.registersHL >> 8;
      var dirtySum =
        parentObj.registerA - temp_var - (parentObj.FCarry ? 1 : 0);
      parentObj.FHalfCarry =
        (parentObj.registerA & 0xf) -
          (temp_var & 0xf) -
          (parentObj.FCarry ? 1 : 0) <
        0;
      parentObj.FCarry = dirtySum < 0;
      parentObj.registerA = dirtySum & 0xff;
      parentObj.FZero = parentObj.registerA == 0;
      parentObj.FSubtract = true;
    },
    //SBC A, L
    //#0x9D:
    function(parentObj: GameBoyCore) {
      var dirtySum =
        parentObj.registerA -
        (parentObj.registersHL & 0xff) -
        (parentObj.FCarry ? 1 : 0);
      parentObj.FHalfCarry =
        (parentObj.registerA & 0xf) -
          (parentObj.registersHL & 0xf) -
          (parentObj.FCarry ? 1 : 0) <
        0;
      parentObj.FCarry = dirtySum < 0;
      parentObj.registerA = dirtySum & 0xff;
      parentObj.FZero = parentObj.registerA == 0;
      parentObj.FSubtract = true;
    },
    //SBC A, (HL)
    //#0x9E:
    function(parentObj: GameBoyCore) {
      var temp_var = parentObj.memoryReader[parentObj.registersHL](
        parentObj,
        parentObj.registersHL
      );
      var dirtySum =
        parentObj.registerA - temp_var - (parentObj.FCarry ? 1 : 0);
      parentObj.FHalfCarry =
        (parentObj.registerA & 0xf) -
          (temp_var & 0xf) -
          (parentObj.FCarry ? 1 : 0) <
        0;
      parentObj.FCarry = dirtySum < 0;
      parentObj.registerA = dirtySum & 0xff;
      parentObj.FZero = parentObj.registerA == 0;
      parentObj.FSubtract = true;
    },
    //SBC A, A
    //#0x9F:
    function(parentObj: GameBoyCore) {
      //Optimized SBC A:
      if (parentObj.FCarry) {
        parentObj.FZero = false;
        parentObj.FSubtract = parentObj.FHalfCarry = parentObj.FCarry = true;
        parentObj.registerA = 0xff;
      } else {
        parentObj.FHalfCarry = parentObj.FCarry = false;
        parentObj.FSubtract = parentObj.FZero = true;
        parentObj.registerA = 0;
      }
    },
    //AND B
    //#0xA0:
    function(parentObj: GameBoyCore) {
      parentObj.registerA &= parentObj.registerB;
      parentObj.FZero = parentObj.registerA == 0;
      parentObj.FHalfCarry = true;
      parentObj.FSubtract = parentObj.FCarry = false;
    },
    //AND C
    //#0xA1:
    function(parentObj: GameBoyCore) {
      parentObj.registerA &= parentObj.registerC;
      parentObj.FZero = parentObj.registerA == 0;
      parentObj.FHalfCarry = true;
      parentObj.FSubtract = parentObj.FCarry = false;
    },
    //AND D
    //#0xA2:
    function(parentObj: GameBoyCore) {
      parentObj.registerA &= parentObj.registerD;
      parentObj.FZero = parentObj.registerA == 0;
      parentObj.FHalfCarry = true;
      parentObj.FSubtract = parentObj.FCarry = false;
    },
    //AND E
    //#0xA3:
    function(parentObj: GameBoyCore) {
      parentObj.registerA &= parentObj.registerE;
      parentObj.FZero = parentObj.registerA == 0;
      parentObj.FHalfCarry = true;
      parentObj.FSubtract = parentObj.FCarry = false;
    },
    //AND H
    //#0xA4:
    function(parentObj: GameBoyCore) {
      parentObj.registerA &= parentObj.registersHL >> 8;
      parentObj.FZero = parentObj.registerA == 0;
      parentObj.FHalfCarry = true;
      parentObj.FSubtract = parentObj.FCarry = false;
    },
    //AND L
    //#0xA5:
    function(parentObj: GameBoyCore) {
      parentObj.registerA &= parentObj.registersHL;
      parentObj.FZero = parentObj.registerA == 0;
      parentObj.FHalfCarry = true;
      parentObj.FSubtract = parentObj.FCarry = false;
    },
    //AND (HL)
    //#0xA6:
    function(parentObj: GameBoyCore) {
      parentObj.registerA &= parentObj.memoryReader[parentObj.registersHL](
        parentObj,
        parentObj.registersHL
      );
      parentObj.FZero = parentObj.registerA == 0;
      parentObj.FHalfCarry = true;
      parentObj.FSubtract = parentObj.FCarry = false;
    },
    //AND A
    //#0xA7:
    function(parentObj: GameBoyCore) {
      //number & same number = same number
      parentObj.FZero = parentObj.registerA == 0;
      parentObj.FHalfCarry = true;
      parentObj.FSubtract = parentObj.FCarry = false;
    },
    //XOR B
    //#0xA8:
    function(parentObj: GameBoyCore) {
      parentObj.registerA ^= parentObj.registerB;
      parentObj.FZero = parentObj.registerA == 0;
      parentObj.FSubtract = parentObj.FHalfCarry = parentObj.FCarry = false;
    },
    //XOR C
    //#0xA9:
    function(parentObj: GameBoyCore) {
      parentObj.registerA ^= parentObj.registerC;
      parentObj.FZero = parentObj.registerA == 0;
      parentObj.FSubtract = parentObj.FHalfCarry = parentObj.FCarry = false;
    },
    //XOR D
    //#0xAA:
    function(parentObj: GameBoyCore) {
      parentObj.registerA ^= parentObj.registerD;
      parentObj.FZero = parentObj.registerA == 0;
      parentObj.FSubtract = parentObj.FHalfCarry = parentObj.FCarry = false;
    },
    //XOR E
    //#0xAB:
    function(parentObj: GameBoyCore) {
      parentObj.registerA ^= parentObj.registerE;
      parentObj.FZero = parentObj.registerA == 0;
      parentObj.FSubtract = parentObj.FHalfCarry = parentObj.FCarry = false;
    },
    //XOR H
    //#0xAC:
    function(parentObj: GameBoyCore) {
      parentObj.registerA ^= parentObj.registersHL >> 8;
      parentObj.FZero = parentObj.registerA == 0;
      parentObj.FSubtract = parentObj.FHalfCarry = parentObj.FCarry = false;
    },
    //XOR L
    //#0xAD:
    function(parentObj: GameBoyCore) {
      parentObj.registerA ^= parentObj.registersHL & 0xff;
      parentObj.FZero = parentObj.registerA == 0;
      parentObj.FSubtract = parentObj.FHalfCarry = parentObj.FCarry = false;
    },
    //XOR (HL)
    //#0xAE:
    function(parentObj: GameBoyCore) {
      parentObj.registerA ^= parentObj.memoryReader[parentObj.registersHL](
        parentObj,
        parentObj.registersHL
      );
      parentObj.FZero = parentObj.registerA == 0;
      parentObj.FSubtract = parentObj.FHalfCarry = parentObj.FCarry = false;
    },
    //XOR A
    //#0xAF:
    function(parentObj: GameBoyCore) {
      //number ^ same number == 0
      parentObj.registerA = 0;
      parentObj.FZero = true;
      parentObj.FSubtract = parentObj.FHalfCarry = parentObj.FCarry = false;
    },
    //OR B
    //#0xB0:
    function(parentObj: GameBoyCore) {
      parentObj.registerA |= parentObj.registerB;
      parentObj.FZero = parentObj.registerA == 0;
      parentObj.FSubtract = parentObj.FCarry = parentObj.FHalfCarry = false;
    },
    //OR C
    //#0xB1:
    function(parentObj: GameBoyCore) {
      parentObj.registerA |= parentObj.registerC;
      parentObj.FZero = parentObj.registerA == 0;
      parentObj.FSubtract = parentObj.FCarry = parentObj.FHalfCarry = false;
    },
    //OR D
    //#0xB2:
    function(parentObj: GameBoyCore) {
      parentObj.registerA |= parentObj.registerD;
      parentObj.FZero = parentObj.registerA == 0;
      parentObj.FSubtract = parentObj.FCarry = parentObj.FHalfCarry = false;
    },
    //OR E
    //#0xB3:
    function(parentObj: GameBoyCore) {
      parentObj.registerA |= parentObj.registerE;
      parentObj.FZero = parentObj.registerA == 0;
      parentObj.FSubtract = parentObj.FCarry = parentObj.FHalfCarry = false;
    },
    //OR H
    //#0xB4:
    function(parentObj: GameBoyCore) {
      parentObj.registerA |= parentObj.registersHL >> 8;
      parentObj.FZero = parentObj.registerA == 0;
      parentObj.FSubtract = parentObj.FCarry = parentObj.FHalfCarry = false;
    },
    //OR L
    //#0xB5:
    function(parentObj: GameBoyCore) {
      parentObj.registerA |= parentObj.registersHL & 0xff;
      parentObj.FZero = parentObj.registerA == 0;
      parentObj.FSubtract = parentObj.FCarry = parentObj.FHalfCarry = false;
    },
    //OR (HL)
    //#0xB6:
    function(parentObj: GameBoyCore) {
      parentObj.registerA |= parentObj.memoryReader[parentObj.registersHL](
        parentObj,
        parentObj.registersHL
      );
      parentObj.FZero = parentObj.registerA == 0;
      parentObj.FSubtract = parentObj.FCarry = parentObj.FHalfCarry = false;
    },
    //OR A
    //#0xB7:
    function(parentObj: GameBoyCore) {
      //number | same number == same number
      parentObj.FZero = parentObj.registerA == 0;
      parentObj.FSubtract = parentObj.FCarry = parentObj.FHalfCarry = false;
    },
    //CP B
    //#0xB8:
    function(parentObj: GameBoyCore) {
      var dirtySum = parentObj.registerA - parentObj.registerB;
      parentObj.FHalfCarry = (dirtySum & 0xf) > (parentObj.registerA & 0xf);
      parentObj.FCarry = dirtySum < 0;
      parentObj.FZero = dirtySum == 0;
      parentObj.FSubtract = true;
    },
    //CP C
    //#0xB9:
    function(parentObj: GameBoyCore) {
      var dirtySum = parentObj.registerA - parentObj.registerC;
      parentObj.FHalfCarry = (dirtySum & 0xf) > (parentObj.registerA & 0xf);
      parentObj.FCarry = dirtySum < 0;
      parentObj.FZero = dirtySum == 0;
      parentObj.FSubtract = true;
    },
    //CP D
    //#0xBA:
    function(parentObj: GameBoyCore) {
      var dirtySum = parentObj.registerA - parentObj.registerD;
      parentObj.FHalfCarry = (dirtySum & 0xf) > (parentObj.registerA & 0xf);
      parentObj.FCarry = dirtySum < 0;
      parentObj.FZero = dirtySum == 0;
      parentObj.FSubtract = true;
    },
    //CP E
    //#0xBB:
    function(parentObj: GameBoyCore) {
      var dirtySum = parentObj.registerA - parentObj.registerE;
      parentObj.FHalfCarry = (dirtySum & 0xf) > (parentObj.registerA & 0xf);
      parentObj.FCarry = dirtySum < 0;
      parentObj.FZero = dirtySum == 0;
      parentObj.FSubtract = true;
    },
    //CP H
    //#0xBC:
    function(parentObj: GameBoyCore) {
      var dirtySum = parentObj.registerA - (parentObj.registersHL >> 8);
      parentObj.FHalfCarry = (dirtySum & 0xf) > (parentObj.registerA & 0xf);
      parentObj.FCarry = dirtySum < 0;
      parentObj.FZero = dirtySum == 0;
      parentObj.FSubtract = true;
    },
    //CP L
    //#0xBD:
    function(parentObj: GameBoyCore) {
      var dirtySum = parentObj.registerA - (parentObj.registersHL & 0xff);
      parentObj.FHalfCarry = (dirtySum & 0xf) > (parentObj.registerA & 0xf);
      parentObj.FCarry = dirtySum < 0;
      parentObj.FZero = dirtySum == 0;
      parentObj.FSubtract = true;
    },
    //CP (HL)
    //#0xBE:
    function(parentObj: GameBoyCore) {
      var dirtySum =
        parentObj.registerA -
        parentObj.memoryReader[parentObj.registersHL](
          parentObj,
          parentObj.registersHL
        );
      parentObj.FHalfCarry = (dirtySum & 0xf) > (parentObj.registerA & 0xf);
      parentObj.FCarry = dirtySum < 0;
      parentObj.FZero = dirtySum == 0;
      parentObj.FSubtract = true;
    },
    //CP A
    //#0xBF:
    function(parentObj: GameBoyCore) {
      parentObj.FHalfCarry = parentObj.FCarry = false;
      parentObj.FZero = parentObj.FSubtract = true;
    },
    //RET !FZ
    //#0xC0:
    function(parentObj: GameBoyCore) {
      if (!parentObj.FZero) {
        parentObj.programCounter =
          (parentObj.memoryRead((parentObj.stackPointer + 1) & 0xffff) << 8) |
          parentObj.memoryReader[parentObj.stackPointer](
            parentObj,
            parentObj.stackPointer
          );
        parentObj.stackPointer = (parentObj.stackPointer + 2) & 0xffff;
        parentObj.CPUTicks += 12;
      }
    },
    //POP BC
    //#0xC1:
    function(parentObj: GameBoyCore) {
      parentObj.registerC = parentObj.memoryReader[parentObj.stackPointer](
        parentObj,
        parentObj.stackPointer
      );
      parentObj.registerB = parentObj.memoryRead(
        (parentObj.stackPointer + 1) & 0xffff
      );
      parentObj.stackPointer = (parentObj.stackPointer + 2) & 0xffff;
    },
    //JP !FZ, nn
    //#0xC2:
    function(parentObj: GameBoyCore) {
      if (!parentObj.FZero) {
        parentObj.programCounter =
          (parentObj.memoryRead((parentObj.programCounter + 1) & 0xffff) << 8) |
          parentObj.memoryReader[parentObj.programCounter](
            parentObj,
            parentObj.programCounter
          );
        parentObj.CPUTicks += 4;
      } else {
        parentObj.programCounter = (parentObj.programCounter + 2) & 0xffff;
      }
    },
    //JP nn
    //#0xC3:
    function(parentObj: GameBoyCore) {
      parentObj.programCounter =
        (parentObj.memoryRead((parentObj.programCounter + 1) & 0xffff) << 8) |
        parentObj.memoryReader[parentObj.programCounter](
          parentObj,
          parentObj.programCounter
        );
    },
    //CALL !FZ, nn
    //#0xC4:
    function(parentObj: GameBoyCore) {
      if (!parentObj.FZero) {
        var temp_pc =
          (parentObj.memoryRead((parentObj.programCounter + 1) & 0xffff) << 8) |
          parentObj.memoryReader[parentObj.programCounter](
            parentObj,
            parentObj.programCounter
          );
        parentObj.programCounter = (parentObj.programCounter + 2) & 0xffff;
        parentObj.stackPointer = (parentObj.stackPointer - 1) & 0xffff;
        parentObj.memoryWriter[parentObj.stackPointer](
          parentObj,
          parentObj.stackPointer,
          parentObj.programCounter >> 8
        );
        parentObj.stackPointer = (parentObj.stackPointer - 1) & 0xffff;
        parentObj.memoryWriter[parentObj.stackPointer](
          parentObj,
          parentObj.stackPointer,
          parentObj.programCounter & 0xff
        );
        parentObj.programCounter = temp_pc;
        parentObj.CPUTicks += 12;
      } else {
        parentObj.programCounter = (parentObj.programCounter + 2) & 0xffff;
      }
    },
    //PUSH BC
    //#0xC5:
    function(parentObj: GameBoyCore) {
      parentObj.stackPointer = (parentObj.stackPointer - 1) & 0xffff;
      parentObj.memoryWriter[parentObj.stackPointer](
        parentObj,
        parentObj.stackPointer,
        parentObj.registerB
      );
      parentObj.stackPointer = (parentObj.stackPointer - 1) & 0xffff;
      parentObj.memoryWriter[parentObj.stackPointer](
        parentObj,
        parentObj.stackPointer,
        parentObj.registerC
      );
    },
    //ADD, n
    //#0xC6:
    function(parentObj: GameBoyCore) {
      var dirtySum =
        parentObj.registerA +
        parentObj.memoryReader[parentObj.programCounter](
          parentObj,
          parentObj.programCounter
        );
      parentObj.programCounter = (parentObj.programCounter + 1) & 0xffff;
      parentObj.FHalfCarry = (dirtySum & 0xf) < (parentObj.registerA & 0xf);
      parentObj.FCarry = dirtySum > 0xff;
      parentObj.registerA = dirtySum & 0xff;
      parentObj.FZero = parentObj.registerA == 0;
      parentObj.FSubtract = false;
    },
    //RST 0
    //#0xC7:
    function(parentObj: GameBoyCore) {
      parentObj.stackPointer = (parentObj.stackPointer - 1) & 0xffff;
      parentObj.memoryWriter[parentObj.stackPointer](
        parentObj,
        parentObj.stackPointer,
        parentObj.programCounter >> 8
      );
      parentObj.stackPointer = (parentObj.stackPointer - 1) & 0xffff;
      parentObj.memoryWriter[parentObj.stackPointer](
        parentObj,
        parentObj.stackPointer,
        parentObj.programCounter & 0xff
      );
      parentObj.programCounter = 0;
    },
    //RET FZ
    //#0xC8:
    function(parentObj: GameBoyCore) {
      if (parentObj.FZero) {
        parentObj.programCounter =
          (parentObj.memoryRead((parentObj.stackPointer + 1) & 0xffff) << 8) |
          parentObj.memoryReader[parentObj.stackPointer](
            parentObj,
            parentObj.stackPointer
          );
        parentObj.stackPointer = (parentObj.stackPointer + 2) & 0xffff;
        parentObj.CPUTicks += 12;
      }
    },
    //RET
    //#0xC9:
    function(parentObj: GameBoyCore) {
      parentObj.programCounter =
        (parentObj.memoryRead((parentObj.stackPointer + 1) & 0xffff) << 8) |
        parentObj.memoryReader[parentObj.stackPointer](
          parentObj,
          parentObj.stackPointer
        );
      parentObj.stackPointer = (parentObj.stackPointer + 2) & 0xffff;
    },
    //JP FZ, nn
    //#0xCA:
    function(parentObj: GameBoyCore) {
      if (parentObj.FZero) {
        parentObj.programCounter =
          (parentObj.memoryRead((parentObj.programCounter + 1) & 0xffff) << 8) |
          parentObj.memoryReader[parentObj.programCounter](
            parentObj,
            parentObj.programCounter
          );
        parentObj.CPUTicks += 4;
      } else {
        parentObj.programCounter = (parentObj.programCounter + 2) & 0xffff;
      }
    },
    //Secondary OP Code Set:
    //#0xCB:
    function(parentObj: GameBoyCore) {
      var opcode = parentObj.memoryReader[parentObj.programCounter](
        parentObj,
        parentObj.programCounter
      );
      //Increment the program counter to the next instruction:
      parentObj.programCounter = (parentObj.programCounter + 1) & 0xffff;
      //Get how many CPU cycles the current 0xCBXX op code counts for:
      parentObj.CPUTicks += parentObj.SecondaryTICKTable[opcode];
      //Execute secondary OP codes for the 0xCB OP code call.
      parentObj.CBOPCODE[opcode](parentObj);
    },
    //CALL FZ, nn
    //#0xCC:
    function(parentObj: GameBoyCore) {
      if (parentObj.FZero) {
        var temp_pc =
          (parentObj.memoryRead((parentObj.programCounter + 1) & 0xffff) << 8) |
          parentObj.memoryReader[parentObj.programCounter](
            parentObj,
            parentObj.programCounter
          );
        parentObj.programCounter = (parentObj.programCounter + 2) & 0xffff;
        parentObj.stackPointer = (parentObj.stackPointer - 1) & 0xffff;
        parentObj.memoryWriter[parentObj.stackPointer](
          parentObj,
          parentObj.stackPointer,
          parentObj.programCounter >> 8
        );
        parentObj.stackPointer = (parentObj.stackPointer - 1) & 0xffff;
        parentObj.memoryWriter[parentObj.stackPointer](
          parentObj,
          parentObj.stackPointer,
          parentObj.programCounter & 0xff
        );
        parentObj.programCounter = temp_pc;
        parentObj.CPUTicks += 12;
      } else {
        parentObj.programCounter = (parentObj.programCounter + 2) & 0xffff;
      }
    },
    //CALL nn
    //#0xCD:
    function(parentObj: GameBoyCore) {
      var temp_pc =
        (parentObj.memoryRead((parentObj.programCounter + 1) & 0xffff) << 8) |
        parentObj.memoryReader[parentObj.programCounter](
          parentObj,
          parentObj.programCounter
        );
      parentObj.programCounter = (parentObj.programCounter + 2) & 0xffff;
      parentObj.stackPointer = (parentObj.stackPointer - 1) & 0xffff;
      parentObj.memoryWriter[parentObj.stackPointer](
        parentObj,
        parentObj.stackPointer,
        parentObj.programCounter >> 8
      );
      parentObj.stackPointer = (parentObj.stackPointer - 1) & 0xffff;
      parentObj.memoryWriter[parentObj.stackPointer](
        parentObj,
        parentObj.stackPointer,
        parentObj.programCounter & 0xff
      );
      parentObj.programCounter = temp_pc;
    },
    //ADC A, n
    //#0xCE:
    function(parentObj: GameBoyCore) {
      var tempValue = parentObj.memoryReader[parentObj.programCounter](
        parentObj,
        parentObj.programCounter
      );
      parentObj.programCounter = (parentObj.programCounter + 1) & 0xffff;
      var dirtySum =
        parentObj.registerA + tempValue + (parentObj.FCarry ? 1 : 0);
      parentObj.FHalfCarry =
        (parentObj.registerA & 0xf) +
          (tempValue & 0xf) +
          (parentObj.FCarry ? 1 : 0) >
        0xf;
      parentObj.FCarry = dirtySum > 0xff;
      parentObj.registerA = dirtySum & 0xff;
      parentObj.FZero = parentObj.registerA == 0;
      parentObj.FSubtract = false;
    },
    //RST 0x8
    //#0xCF:
    function(parentObj: GameBoyCore) {
      parentObj.stackPointer = (parentObj.stackPointer - 1) & 0xffff;
      parentObj.memoryWriter[parentObj.stackPointer](
        parentObj,
        parentObj.stackPointer,
        parentObj.programCounter >> 8
      );
      parentObj.stackPointer = (parentObj.stackPointer - 1) & 0xffff;
      parentObj.memoryWriter[parentObj.stackPointer](
        parentObj,
        parentObj.stackPointer,
        parentObj.programCounter & 0xff
      );
      parentObj.programCounter = 0x8;
    },
    //RET !FC
    //#0xD0:
    function(parentObj: GameBoyCore) {
      if (!parentObj.FCarry) {
        parentObj.programCounter =
          (parentObj.memoryRead((parentObj.stackPointer + 1) & 0xffff) << 8) |
          parentObj.memoryReader[parentObj.stackPointer](
            parentObj,
            parentObj.stackPointer
          );
        parentObj.stackPointer = (parentObj.stackPointer + 2) & 0xffff;
        parentObj.CPUTicks += 12;
      }
    },
    //POP DE
    //#0xD1:
    function(parentObj: GameBoyCore) {
      parentObj.registerE = parentObj.memoryReader[parentObj.stackPointer](
        parentObj,
        parentObj.stackPointer
      );
      parentObj.registerD = parentObj.memoryRead(
        (parentObj.stackPointer + 1) & 0xffff
      );
      parentObj.stackPointer = (parentObj.stackPointer + 2) & 0xffff;
    },
    //JP !FC, nn
    //#0xD2:
    function(parentObj: GameBoyCore) {
      if (!parentObj.FCarry) {
        parentObj.programCounter =
          (parentObj.memoryRead((parentObj.programCounter + 1) & 0xffff) << 8) |
          parentObj.memoryReader[parentObj.programCounter](
            parentObj,
            parentObj.programCounter
          );
        parentObj.CPUTicks += 4;
      } else {
        parentObj.programCounter = (parentObj.programCounter + 2) & 0xffff;
      }
    },
    //0xD3 - Illegal
    //#0xD3:
    function(parentObj: GameBoyCore) {
      cout("Illegal op code 0xD3 called, pausing emulation.", 2);
      pause();
    },
    //CALL !FC, nn
    //#0xD4:
    function(parentObj: GameBoyCore) {
      if (!parentObj.FCarry) {
        var temp_pc =
          (parentObj.memoryRead((parentObj.programCounter + 1) & 0xffff) << 8) |
          parentObj.memoryReader[parentObj.programCounter](
            parentObj,
            parentObj.programCounter
          );
        parentObj.programCounter = (parentObj.programCounter + 2) & 0xffff;
        parentObj.stackPointer = (parentObj.stackPointer - 1) & 0xffff;
        parentObj.memoryWriter[parentObj.stackPointer](
          parentObj,
          parentObj.stackPointer,
          parentObj.programCounter >> 8
        );
        parentObj.stackPointer = (parentObj.stackPointer - 1) & 0xffff;
        parentObj.memoryWriter[parentObj.stackPointer](
          parentObj,
          parentObj.stackPointer,
          parentObj.programCounter & 0xff
        );
        parentObj.programCounter = temp_pc;
        parentObj.CPUTicks += 12;
      } else {
        parentObj.programCounter = (parentObj.programCounter + 2) & 0xffff;
      }
    },
    //PUSH DE
    //#0xD5:
    function(parentObj: GameBoyCore) {
      parentObj.stackPointer = (parentObj.stackPointer - 1) & 0xffff;
      parentObj.memoryWriter[parentObj.stackPointer](
        parentObj,
        parentObj.stackPointer,
        parentObj.registerD
      );
      parentObj.stackPointer = (parentObj.stackPointer - 1) & 0xffff;
      parentObj.memoryWriter[parentObj.stackPointer](
        parentObj,
        parentObj.stackPointer,
        parentObj.registerE
      );
    },
    //SUB A, n
    //#0xD6:
    function(parentObj: GameBoyCore) {
      var dirtySum =
        parentObj.registerA -
        parentObj.memoryReader[parentObj.programCounter](
          parentObj,
          parentObj.programCounter
        );
      parentObj.programCounter = (parentObj.programCounter + 1) & 0xffff;
      parentObj.FHalfCarry = (parentObj.registerA & 0xf) < (dirtySum & 0xf);
      parentObj.FCarry = dirtySum < 0;
      parentObj.registerA = dirtySum & 0xff;
      parentObj.FZero = dirtySum == 0;
      parentObj.FSubtract = true;
    },
    //RST 0x10
    //#0xD7:
    function(parentObj: GameBoyCore) {
      parentObj.stackPointer = (parentObj.stackPointer - 1) & 0xffff;
      parentObj.memoryWriter[parentObj.stackPointer](
        parentObj,
        parentObj.stackPointer,
        parentObj.programCounter >> 8
      );
      parentObj.stackPointer = (parentObj.stackPointer - 1) & 0xffff;
      parentObj.memoryWriter[parentObj.stackPointer](
        parentObj,
        parentObj.stackPointer,
        parentObj.programCounter & 0xff
      );
      parentObj.programCounter = 0x10;
    },
    //RET FC
    //#0xD8:
    function(parentObj: GameBoyCore) {
      if (parentObj.FCarry) {
        parentObj.programCounter =
          (parentObj.memoryRead((parentObj.stackPointer + 1) & 0xffff) << 8) |
          parentObj.memoryReader[parentObj.stackPointer](
            parentObj,
            parentObj.stackPointer
          );
        parentObj.stackPointer = (parentObj.stackPointer + 2) & 0xffff;
        parentObj.CPUTicks += 12;
      }
    },
    //RETI
    //#0xD9:
    function(parentObj: GameBoyCore) {
      parentObj.programCounter =
        (parentObj.memoryRead((parentObj.stackPointer + 1) & 0xffff) << 8) |
        parentObj.memoryReader[parentObj.stackPointer](
          parentObj,
          parentObj.stackPointer
        );
      parentObj.stackPointer = (parentObj.stackPointer + 2) & 0xffff;
      //Immediate for HALT:
      parentObj.IRQEnableDelay =
        parentObj.IRQEnableDelay == 2 ||
        parentObj.memoryReader[parentObj.programCounter](
          parentObj,
          parentObj.programCounter
        ) == 0x76
          ? 1
          : 2;
    },
    //JP FC, nn
    //#0xDA:
    function(parentObj: GameBoyCore) {
      if (parentObj.FCarry) {
        parentObj.programCounter =
          (parentObj.memoryRead((parentObj.programCounter + 1) & 0xffff) << 8) |
          parentObj.memoryReader[parentObj.programCounter](
            parentObj,
            parentObj.programCounter
          );
        parentObj.CPUTicks += 4;
      } else {
        parentObj.programCounter = (parentObj.programCounter + 2) & 0xffff;
      }
    },
    //0xDB - Illegal
    //#0xDB:
    function(parentObj: GameBoyCore) {
      cout("Illegal op code 0xDB called, pausing emulation.", 2);
      pause();
    },
    //CALL FC, nn
    //#0xDC:
    function(parentObj: GameBoyCore) {
      if (parentObj.FCarry) {
        var temp_pc =
          (parentObj.memoryRead((parentObj.programCounter + 1) & 0xffff) << 8) |
          parentObj.memoryReader[parentObj.programCounter](
            parentObj,
            parentObj.programCounter
          );
        parentObj.programCounter = (parentObj.programCounter + 2) & 0xffff;
        parentObj.stackPointer = (parentObj.stackPointer - 1) & 0xffff;
        parentObj.memoryWriter[parentObj.stackPointer](
          parentObj,
          parentObj.stackPointer,
          parentObj.programCounter >> 8
        );
        parentObj.stackPointer = (parentObj.stackPointer - 1) & 0xffff;
        parentObj.memoryWriter[parentObj.stackPointer](
          parentObj,
          parentObj.stackPointer,
          parentObj.programCounter & 0xff
        );
        parentObj.programCounter = temp_pc;
        parentObj.CPUTicks += 12;
      } else {
        parentObj.programCounter = (parentObj.programCounter + 2) & 0xffff;
      }
    },
    //0xDD - Illegal
    //#0xDD:
    function(parentObj: GameBoyCore) {
      cout("Illegal op code 0xDD called, pausing emulation.", 2);
      pause();
    },
    //SBC A, n
    //#0xDE:
    function(parentObj: GameBoyCore) {
      var temp_var = parentObj.memoryReader[parentObj.programCounter](
        parentObj,
        parentObj.programCounter
      );
      parentObj.programCounter = (parentObj.programCounter + 1) & 0xffff;
      var dirtySum =
        parentObj.registerA - temp_var - (parentObj.FCarry ? 1 : 0);
      parentObj.FHalfCarry =
        (parentObj.registerA & 0xf) -
          (temp_var & 0xf) -
          (parentObj.FCarry ? 1 : 0) <
        0;
      parentObj.FCarry = dirtySum < 0;
      parentObj.registerA = dirtySum & 0xff;
      parentObj.FZero = parentObj.registerA == 0;
      parentObj.FSubtract = true;
    },
    //RST 0x18
    //#0xDF:
    function(parentObj: GameBoyCore) {
      parentObj.stackPointer = (parentObj.stackPointer - 1) & 0xffff;
      parentObj.memoryWriter[parentObj.stackPointer](
        parentObj,
        parentObj.stackPointer,
        parentObj.programCounter >> 8
      );
      parentObj.stackPointer = (parentObj.stackPointer - 1) & 0xffff;
      parentObj.memoryWriter[parentObj.stackPointer](
        parentObj,
        parentObj.stackPointer,
        parentObj.programCounter & 0xff
      );
      parentObj.programCounter = 0x18;
    },
    //LDH (n), A
    //#0xE0:
    function(parentObj: GameBoyCore) {
      parentObj.memoryHighWrite(
        parentObj.memoryReader[parentObj.programCounter](
          parentObj,
          parentObj.programCounter
        ),
        parentObj.registerA
      );
      parentObj.programCounter = (parentObj.programCounter + 1) & 0xffff;
    },
    //POP HL
    //#0xE1:
    function(parentObj: GameBoyCore) {
      parentObj.registersHL =
        (parentObj.memoryRead((parentObj.stackPointer + 1) & 0xffff) << 8) |
        parentObj.memoryReader[parentObj.stackPointer](
          parentObj,
          parentObj.stackPointer
        );
      parentObj.stackPointer = (parentObj.stackPointer + 2) & 0xffff;
    },
    //LD (0xFF00 + C), A
    //#0xE2:
    function(parentObj: GameBoyCore) {
      parentObj.memoryHighWriter[parentObj.registerC](
        parentObj,
        parentObj.registerC,
        parentObj.registerA
      );
    },
    //0xE3 - Illegal
    //#0xE3:
    function(parentObj: GameBoyCore) {
      cout("Illegal op code 0xE3 called, pausing emulation.", 2);
      pause();
    },
    //0xE4 - Illegal
    //#0xE4:
    function(parentObj: GameBoyCore) {
      cout("Illegal op code 0xE4 called, pausing emulation.", 2);
      pause();
    },
    //PUSH HL
    //#0xE5:
    function(parentObj: GameBoyCore) {
      parentObj.stackPointer = (parentObj.stackPointer - 1) & 0xffff;
      parentObj.memoryWriter[parentObj.stackPointer](
        parentObj,
        parentObj.stackPointer,
        parentObj.registersHL >> 8
      );
      parentObj.stackPointer = (parentObj.stackPointer - 1) & 0xffff;
      parentObj.memoryWriter[parentObj.stackPointer](
        parentObj,
        parentObj.stackPointer,
        parentObj.registersHL & 0xff
      );
    },
    //AND n
    //#0xE6:
    function(parentObj: GameBoyCore) {
      parentObj.registerA &= parentObj.memoryReader[parentObj.programCounter](
        parentObj,
        parentObj.programCounter
      );
      parentObj.programCounter = (parentObj.programCounter + 1) & 0xffff;
      parentObj.FZero = parentObj.registerA == 0;
      parentObj.FHalfCarry = true;
      parentObj.FSubtract = parentObj.FCarry = false;
    },
    //RST 0x20
    //#0xE7:
    function(parentObj: GameBoyCore) {
      parentObj.stackPointer = (parentObj.stackPointer - 1) & 0xffff;
      parentObj.memoryWriter[parentObj.stackPointer](
        parentObj,
        parentObj.stackPointer,
        parentObj.programCounter >> 8
      );
      parentObj.stackPointer = (parentObj.stackPointer - 1) & 0xffff;
      parentObj.memoryWriter[parentObj.stackPointer](
        parentObj,
        parentObj.stackPointer,
        parentObj.programCounter & 0xff
      );
      parentObj.programCounter = 0x20;
    },
    //ADD SP, n
    //#0xE8:
    function(parentObj: GameBoyCore) {
      var temp_value2 =
        (parentObj.memoryReader[parentObj.programCounter](
          parentObj,
          parentObj.programCounter
        ) <<
          24) >>
        24;
      parentObj.programCounter = (parentObj.programCounter + 1) & 0xffff;
      var temp_value = (parentObj.stackPointer + temp_value2) & 0xffff;
      temp_value2 = parentObj.stackPointer ^ temp_value2 ^ temp_value;
      parentObj.stackPointer = temp_value;
      parentObj.FCarry = (temp_value2 & 0x100) == 0x100;
      parentObj.FHalfCarry = (temp_value2 & 0x10) == 0x10;
      parentObj.FZero = parentObj.FSubtract = false;
    },
    //JP, (HL)
    //#0xE9:
    function(parentObj: GameBoyCore) {
      parentObj.programCounter = parentObj.registersHL;
    },
    //LD n, A
    //#0xEA:
    function(parentObj: GameBoyCore) {
      parentObj.memoryWrite(
        (parentObj.memoryRead((parentObj.programCounter + 1) & 0xffff) << 8) |
          parentObj.memoryReader[parentObj.programCounter](
            parentObj,
            parentObj.programCounter
          ),
        parentObj.registerA
      );
      parentObj.programCounter = (parentObj.programCounter + 2) & 0xffff;
    },
    //0xEB - Illegal
    //#0xEB:
    function(parentObj: GameBoyCore) {
      cout("Illegal op code 0xEB called, pausing emulation.", 2);
      pause();
    },
    //0xEC - Illegal
    //#0xEC:
    function(parentObj: GameBoyCore) {
      cout("Illegal op code 0xEC called, pausing emulation.", 2);
      pause();
    },
    //0xED - Illegal
    //#0xED:
    function(parentObj: GameBoyCore) {
      cout("Illegal op code 0xED called, pausing emulation.", 2);
      pause();
    },
    //XOR n
    //#0xEE:
    function(parentObj: GameBoyCore) {
      parentObj.registerA ^= parentObj.memoryReader[parentObj.programCounter](
        parentObj,
        parentObj.programCounter
      );
      parentObj.programCounter = (parentObj.programCounter + 1) & 0xffff;
      parentObj.FZero = parentObj.registerA == 0;
      parentObj.FSubtract = parentObj.FHalfCarry = parentObj.FCarry = false;
    },
    //RST 0x28
    //#0xEF:
    function(parentObj: GameBoyCore) {
      parentObj.stackPointer = (parentObj.stackPointer - 1) & 0xffff;
      parentObj.memoryWriter[parentObj.stackPointer](
        parentObj,
        parentObj.stackPointer,
        parentObj.programCounter >> 8
      );
      parentObj.stackPointer = (parentObj.stackPointer - 1) & 0xffff;
      parentObj.memoryWriter[parentObj.stackPointer](
        parentObj,
        parentObj.stackPointer,
        parentObj.programCounter & 0xff
      );
      parentObj.programCounter = 0x28;
    },
    //LDH A, (n)
    //#0xF0:
    function(parentObj: GameBoyCore) {
      parentObj.registerA = parentObj.memoryHighRead(
        parentObj.memoryReader[parentObj.programCounter](
          parentObj,
          parentObj.programCounter
        )
      );
      parentObj.programCounter = (parentObj.programCounter + 1) & 0xffff;
    },
    //POP AF
    //#0xF1:
    function(parentObj: GameBoyCore) {
      var temp_var = parentObj.memoryReader[parentObj.stackPointer](
        parentObj,
        parentObj.stackPointer
      );
      parentObj.FZero = temp_var > 0x7f;
      parentObj.FSubtract = (temp_var & 0x40) == 0x40;
      parentObj.FHalfCarry = (temp_var & 0x20) == 0x20;
      parentObj.FCarry = (temp_var & 0x10) == 0x10;
      parentObj.registerA = parentObj.memoryRead(
        (parentObj.stackPointer + 1) & 0xffff
      );
      parentObj.stackPointer = (parentObj.stackPointer + 2) & 0xffff;
    },
    //LD A, (0xFF00 + C)
    //#0xF2:
    function(parentObj: GameBoyCore) {
      parentObj.registerA = parentObj.memoryHighReader[parentObj.registerC](
        parentObj,
        parentObj.registerC
      );
    },
    //DI
    //#0xF3:
    function(parentObj: GameBoyCore) {
      parentObj.IME = false;
      parentObj.IRQEnableDelay = 0;
    },
    //0xF4 - Illegal
    //#0xF4:
    function(parentObj: GameBoyCore) {
      cout("Illegal op code 0xF4 called, pausing emulation.", 2);
      pause();
    },
    //PUSH AF
    //#0xF5:
    function(parentObj: GameBoyCore) {
      parentObj.stackPointer = (parentObj.stackPointer - 1) & 0xffff;
      parentObj.memoryWriter[parentObj.stackPointer](
        parentObj,
        parentObj.stackPointer,
        parentObj.registerA
      );
      parentObj.stackPointer = (parentObj.stackPointer - 1) & 0xffff;
      parentObj.memoryWriter[parentObj.stackPointer](
        parentObj,
        parentObj.stackPointer,
        (parentObj.FZero ? 0x80 : 0) |
          (parentObj.FSubtract ? 0x40 : 0) |
          (parentObj.FHalfCarry ? 0x20 : 0) |
          (parentObj.FCarry ? 0x10 : 0)
      );
    },
    //OR n
    //#0xF6:
    function(parentObj: GameBoyCore) {
      parentObj.registerA |= parentObj.memoryReader[parentObj.programCounter](
        parentObj,
        parentObj.programCounter
      );
      parentObj.FZero = parentObj.registerA == 0;
      parentObj.programCounter = (parentObj.programCounter + 1) & 0xffff;
      parentObj.FSubtract = parentObj.FCarry = parentObj.FHalfCarry = false;
    },
    //RST 0x30
    //#0xF7:
    function(parentObj: GameBoyCore) {
      parentObj.stackPointer = (parentObj.stackPointer - 1) & 0xffff;
      parentObj.memoryWriter[parentObj.stackPointer](
        parentObj,
        parentObj.stackPointer,
        parentObj.programCounter >> 8
      );
      parentObj.stackPointer = (parentObj.stackPointer - 1) & 0xffff;
      parentObj.memoryWriter[parentObj.stackPointer](
        parentObj,
        parentObj.stackPointer,
        parentObj.programCounter & 0xff
      );
      parentObj.programCounter = 0x30;
    },
    //LDHL SP, n
    //#0xF8:
    function(parentObj: GameBoyCore) {
      var temp_var =
        (parentObj.memoryReader[parentObj.programCounter](
          parentObj,
          parentObj.programCounter
        ) <<
          24) >>
        24;
      parentObj.programCounter = (parentObj.programCounter + 1) & 0xffff;
      parentObj.registersHL = (parentObj.stackPointer + temp_var) & 0xffff;
      temp_var = parentObj.stackPointer ^ temp_var ^ parentObj.registersHL;
      parentObj.FCarry = (temp_var & 0x100) == 0x100;
      parentObj.FHalfCarry = (temp_var & 0x10) == 0x10;
      parentObj.FZero = parentObj.FSubtract = false;
    },
    //LD SP, HL
    //#0xF9:
    function(parentObj: GameBoyCore) {
      parentObj.stackPointer = parentObj.registersHL;
    },
    //LD A, (nn)
    //#0xFA:
    function(parentObj: GameBoyCore) {
      parentObj.registerA = parentObj.memoryRead(
        (parentObj.memoryRead((parentObj.programCounter + 1) & 0xffff) << 8) |
          parentObj.memoryReader[parentObj.programCounter](
            parentObj,
            parentObj.programCounter
          )
      );
      parentObj.programCounter = (parentObj.programCounter + 2) & 0xffff;
    },
    //EI
    //#0xFB:
    function(parentObj: GameBoyCore) {
      //Immediate for HALT:
      parentObj.IRQEnableDelay =
        parentObj.IRQEnableDelay == 2 ||
        parentObj.memoryReader[parentObj.programCounter](
          parentObj,
          parentObj.programCounter
        ) == 0x76
          ? 1
          : 2;
    },
    //0xFC - Illegal
    //#0xFC:
    function(parentObj: GameBoyCore) {
      cout("Illegal op code 0xFC called, pausing emulation.", 2);
      pause();
    },
    //0xFD - Illegal
    //#0xFD:
    function(parentObj: GameBoyCore) {
      cout("Illegal op code 0xFD called, pausing emulation.", 2);
      pause();
    },
    //CP n
    //#0xFE:
    function(parentObj: GameBoyCore) {
      var dirtySum =
        parentObj.registerA -
        parentObj.memoryReader[parentObj.programCounter](
          parentObj,
          parentObj.programCounter
        );
      parentObj.programCounter = (parentObj.programCounter + 1) & 0xffff;
      parentObj.FHalfCarry = (dirtySum & 0xf) > (parentObj.registerA & 0xf);
      parentObj.FCarry = dirtySum < 0;
      parentObj.FZero = dirtySum == 0;
      parentObj.FSubtract = true;
    },
    //RST 0x38
    //#0xFF:
    function(parentObj: GameBoyCore) {
      parentObj.stackPointer = (parentObj.stackPointer - 1) & 0xffff;
      parentObj.memoryWriter[parentObj.stackPointer](
        parentObj,
        parentObj.stackPointer,
        parentObj.programCounter >> 8
      );
      parentObj.stackPointer = (parentObj.stackPointer - 1) & 0xffff;
      parentObj.memoryWriter[parentObj.stackPointer](
        parentObj,
        parentObj.stackPointer,
        parentObj.programCounter & 0xff
      );
      parentObj.programCounter = 0x38;
    }
  ];

  CBOPCODE = [
    //RLC B
    //#0x00:
    function(parentObj: GameBoyCore) {
      parentObj.FCarry = parentObj.registerB > 0x7f;
      parentObj.registerB =
        ((parentObj.registerB << 1) & 0xff) | (parentObj.FCarry ? 1 : 0);
      parentObj.FHalfCarry = parentObj.FSubtract = false;
      parentObj.FZero = parentObj.registerB == 0;
    },
    //RLC C
    //#0x01:
    function(parentObj: GameBoyCore) {
      parentObj.FCarry = parentObj.registerC > 0x7f;
      parentObj.registerC =
        ((parentObj.registerC << 1) & 0xff) | (parentObj.FCarry ? 1 : 0);
      parentObj.FHalfCarry = parentObj.FSubtract = false;
      parentObj.FZero = parentObj.registerC == 0;
    },
    //RLC D
    //#0x02:
    function(parentObj: GameBoyCore) {
      parentObj.FCarry = parentObj.registerD > 0x7f;
      parentObj.registerD =
        ((parentObj.registerD << 1) & 0xff) | (parentObj.FCarry ? 1 : 0);
      parentObj.FHalfCarry = parentObj.FSubtract = false;
      parentObj.FZero = parentObj.registerD == 0;
    },
    //RLC E
    //#0x03:
    function(parentObj: GameBoyCore) {
      parentObj.FCarry = parentObj.registerE > 0x7f;
      parentObj.registerE =
        ((parentObj.registerE << 1) & 0xff) | (parentObj.FCarry ? 1 : 0);
      parentObj.FHalfCarry = parentObj.FSubtract = false;
      parentObj.FZero = parentObj.registerE == 0;
    },
    //RLC H
    //#0x04:
    function(parentObj: GameBoyCore) {
      parentObj.FCarry = parentObj.registersHL > 0x7fff;
      parentObj.registersHL =
        ((parentObj.registersHL << 1) & 0xfe00) |
        (parentObj.FCarry ? 0x100 : 0) |
        (parentObj.registersHL & 0xff);
      parentObj.FHalfCarry = parentObj.FSubtract = false;
      parentObj.FZero = parentObj.registersHL < 0x100;
    },
    //RLC L
    //#0x05:
    function(parentObj: GameBoyCore) {
      parentObj.FCarry = (parentObj.registersHL & 0x80) == 0x80;
      parentObj.registersHL =
        (parentObj.registersHL & 0xff00) |
        ((parentObj.registersHL << 1) & 0xff) |
        (parentObj.FCarry ? 1 : 0);
      parentObj.FHalfCarry = parentObj.FSubtract = false;
      parentObj.FZero = (parentObj.registersHL & 0xff) == 0;
    },
    //RLC (HL)
    //#0x06:
    function(parentObj: GameBoyCore) {
      var temp_var = parentObj.memoryReader[parentObj.registersHL](
        parentObj,
        parentObj.registersHL
      );
      parentObj.FCarry = temp_var > 0x7f;
      temp_var = ((temp_var << 1) & 0xff) | (parentObj.FCarry ? 1 : 0);
      parentObj.memoryWriter[parentObj.registersHL](
        parentObj,
        parentObj.registersHL,
        temp_var
      );
      parentObj.FHalfCarry = parentObj.FSubtract = false;
      parentObj.FZero = temp_var == 0;
    },
    //RLC A
    //#0x07:
    function(parentObj: GameBoyCore) {
      parentObj.FCarry = parentObj.registerA > 0x7f;
      parentObj.registerA =
        ((parentObj.registerA << 1) & 0xff) | (parentObj.FCarry ? 1 : 0);
      parentObj.FHalfCarry = parentObj.FSubtract = false;
      parentObj.FZero = parentObj.registerA == 0;
    },
    //RRC B
    //#0x08:
    function(parentObj: GameBoyCore) {
      parentObj.FCarry = (parentObj.registerB & 0x01) == 0x01;
      parentObj.registerB =
        (parentObj.FCarry ? 0x80 : 0) | (parentObj.registerB >> 1);
      parentObj.FHalfCarry = parentObj.FSubtract = false;
      parentObj.FZero = parentObj.registerB == 0;
    },
    //RRC C
    //#0x09:
    function(parentObj: GameBoyCore) {
      parentObj.FCarry = (parentObj.registerC & 0x01) == 0x01;
      parentObj.registerC =
        (parentObj.FCarry ? 0x80 : 0) | (parentObj.registerC >> 1);
      parentObj.FHalfCarry = parentObj.FSubtract = false;
      parentObj.FZero = parentObj.registerC == 0;
    },
    //RRC D
    //#0x0A:
    function(parentObj: GameBoyCore) {
      parentObj.FCarry = (parentObj.registerD & 0x01) == 0x01;
      parentObj.registerD =
        (parentObj.FCarry ? 0x80 : 0) | (parentObj.registerD >> 1);
      parentObj.FHalfCarry = parentObj.FSubtract = false;
      parentObj.FZero = parentObj.registerD == 0;
    },
    //RRC E
    //#0x0B:
    function(parentObj: GameBoyCore) {
      parentObj.FCarry = (parentObj.registerE & 0x01) == 0x01;
      parentObj.registerE =
        (parentObj.FCarry ? 0x80 : 0) | (parentObj.registerE >> 1);
      parentObj.FHalfCarry = parentObj.FSubtract = false;
      parentObj.FZero = parentObj.registerE == 0;
    },
    //RRC H
    //#0x0C:
    function(parentObj: GameBoyCore) {
      parentObj.FCarry = (parentObj.registersHL & 0x0100) == 0x0100;
      parentObj.registersHL =
        (parentObj.FCarry ? 0x8000 : 0) |
        ((parentObj.registersHL >> 1) & 0xff00) |
        (parentObj.registersHL & 0xff);
      parentObj.FHalfCarry = parentObj.FSubtract = false;
      parentObj.FZero = parentObj.registersHL < 0x100;
    },
    //RRC L
    //#0x0D:
    function(parentObj: GameBoyCore) {
      parentObj.FCarry = (parentObj.registersHL & 0x01) == 0x01;
      parentObj.registersHL =
        (parentObj.registersHL & 0xff00) |
        (parentObj.FCarry ? 0x80 : 0) |
        ((parentObj.registersHL & 0xff) >> 1);
      parentObj.FHalfCarry = parentObj.FSubtract = false;
      parentObj.FZero = (parentObj.registersHL & 0xff) == 0;
    },
    //RRC (HL)
    //#0x0E:
    function(parentObj: GameBoyCore) {
      var temp_var = parentObj.memoryReader[parentObj.registersHL](
        parentObj,
        parentObj.registersHL
      );
      parentObj.FCarry = (temp_var & 0x01) == 0x01;
      temp_var = (parentObj.FCarry ? 0x80 : 0) | (temp_var >> 1);
      parentObj.memoryWriter[parentObj.registersHL](
        parentObj,
        parentObj.registersHL,
        temp_var
      );
      parentObj.FHalfCarry = parentObj.FSubtract = false;
      parentObj.FZero = temp_var == 0;
    },
    //RRC A
    //#0x0F:
    function(parentObj: GameBoyCore) {
      parentObj.FCarry = (parentObj.registerA & 0x01) == 0x01;
      parentObj.registerA =
        (parentObj.FCarry ? 0x80 : 0) | (parentObj.registerA >> 1);
      parentObj.FHalfCarry = parentObj.FSubtract = false;
      parentObj.FZero = parentObj.registerA == 0;
    },
    //RL B
    //#0x10:
    function(parentObj: GameBoyCore) {
      var newFCarry = parentObj.registerB > 0x7f;
      parentObj.registerB =
        ((parentObj.registerB << 1) & 0xff) | (parentObj.FCarry ? 1 : 0);
      parentObj.FCarry = newFCarry;
      parentObj.FHalfCarry = parentObj.FSubtract = false;
      parentObj.FZero = parentObj.registerB == 0;
    },
    //RL C
    //#0x11:
    function(parentObj: GameBoyCore) {
      var newFCarry = parentObj.registerC > 0x7f;
      parentObj.registerC =
        ((parentObj.registerC << 1) & 0xff) | (parentObj.FCarry ? 1 : 0);
      parentObj.FCarry = newFCarry;
      parentObj.FHalfCarry = parentObj.FSubtract = false;
      parentObj.FZero = parentObj.registerC == 0;
    },
    //RL D
    //#0x12:
    function(parentObj: GameBoyCore) {
      var newFCarry = parentObj.registerD > 0x7f;
      parentObj.registerD =
        ((parentObj.registerD << 1) & 0xff) | (parentObj.FCarry ? 1 : 0);
      parentObj.FCarry = newFCarry;
      parentObj.FHalfCarry = parentObj.FSubtract = false;
      parentObj.FZero = parentObj.registerD == 0;
    },
    //RL E
    //#0x13:
    function(parentObj: GameBoyCore) {
      var newFCarry = parentObj.registerE > 0x7f;
      parentObj.registerE =
        ((parentObj.registerE << 1) & 0xff) | (parentObj.FCarry ? 1 : 0);
      parentObj.FCarry = newFCarry;
      parentObj.FHalfCarry = parentObj.FSubtract = false;
      parentObj.FZero = parentObj.registerE == 0;
    },
    //RL H
    //#0x14:
    function(parentObj: GameBoyCore) {
      var newFCarry = parentObj.registersHL > 0x7fff;
      parentObj.registersHL =
        ((parentObj.registersHL << 1) & 0xfe00) |
        (parentObj.FCarry ? 0x100 : 0) |
        (parentObj.registersHL & 0xff);
      parentObj.FCarry = newFCarry;
      parentObj.FHalfCarry = parentObj.FSubtract = false;
      parentObj.FZero = parentObj.registersHL < 0x100;
    },
    //RL L
    //#0x15:
    function(parentObj: GameBoyCore) {
      var newFCarry = (parentObj.registersHL & 0x80) == 0x80;
      parentObj.registersHL =
        (parentObj.registersHL & 0xff00) |
        ((parentObj.registersHL << 1) & 0xff) |
        (parentObj.FCarry ? 1 : 0);
      parentObj.FCarry = newFCarry;
      parentObj.FHalfCarry = parentObj.FSubtract = false;
      parentObj.FZero = (parentObj.registersHL & 0xff) == 0;
    },
    //RL (HL)
    //#0x16:
    function(parentObj: GameBoyCore) {
      var temp_var = parentObj.memoryReader[parentObj.registersHL](
        parentObj,
        parentObj.registersHL
      );
      var newFCarry = temp_var > 0x7f;
      temp_var = ((temp_var << 1) & 0xff) | (parentObj.FCarry ? 1 : 0);
      parentObj.FCarry = newFCarry;
      parentObj.memoryWriter[parentObj.registersHL](
        parentObj,
        parentObj.registersHL,
        temp_var
      );
      parentObj.FHalfCarry = parentObj.FSubtract = false;
      parentObj.FZero = temp_var == 0;
    },
    //RL A
    //#0x17:
    function(parentObj: GameBoyCore) {
      var newFCarry = parentObj.registerA > 0x7f;
      parentObj.registerA =
        ((parentObj.registerA << 1) & 0xff) | (parentObj.FCarry ? 1 : 0);
      parentObj.FCarry = newFCarry;
      parentObj.FHalfCarry = parentObj.FSubtract = false;
      parentObj.FZero = parentObj.registerA == 0;
    },
    //RR B
    //#0x18:
    function(parentObj: GameBoyCore) {
      var newFCarry = (parentObj.registerB & 0x01) == 0x01;
      parentObj.registerB =
        (parentObj.FCarry ? 0x80 : 0) | (parentObj.registerB >> 1);
      parentObj.FCarry = newFCarry;
      parentObj.FHalfCarry = parentObj.FSubtract = false;
      parentObj.FZero = parentObj.registerB == 0;
    },
    //RR C
    //#0x19:
    function(parentObj: GameBoyCore) {
      var newFCarry = (parentObj.registerC & 0x01) == 0x01;
      parentObj.registerC =
        (parentObj.FCarry ? 0x80 : 0) | (parentObj.registerC >> 1);
      parentObj.FCarry = newFCarry;
      parentObj.FHalfCarry = parentObj.FSubtract = false;
      parentObj.FZero = parentObj.registerC == 0;
    },
    //RR D
    //#0x1A:
    function(parentObj: GameBoyCore) {
      var newFCarry = (parentObj.registerD & 0x01) == 0x01;
      parentObj.registerD =
        (parentObj.FCarry ? 0x80 : 0) | (parentObj.registerD >> 1);
      parentObj.FCarry = newFCarry;
      parentObj.FHalfCarry = parentObj.FSubtract = false;
      parentObj.FZero = parentObj.registerD == 0;
    },
    //RR E
    //#0x1B:
    function(parentObj: GameBoyCore) {
      var newFCarry = (parentObj.registerE & 0x01) == 0x01;
      parentObj.registerE =
        (parentObj.FCarry ? 0x80 : 0) | (parentObj.registerE >> 1);
      parentObj.FCarry = newFCarry;
      parentObj.FHalfCarry = parentObj.FSubtract = false;
      parentObj.FZero = parentObj.registerE == 0;
    },
    //RR H
    //#0x1C:
    function(parentObj: GameBoyCore) {
      var newFCarry = (parentObj.registersHL & 0x0100) == 0x0100;
      parentObj.registersHL =
        (parentObj.FCarry ? 0x8000 : 0) |
        ((parentObj.registersHL >> 1) & 0xff00) |
        (parentObj.registersHL & 0xff);
      parentObj.FCarry = newFCarry;
      parentObj.FHalfCarry = parentObj.FSubtract = false;
      parentObj.FZero = parentObj.registersHL < 0x100;
    },
    //RR L
    //#0x1D:
    function(parentObj: GameBoyCore) {
      var newFCarry = (parentObj.registersHL & 0x01) == 0x01;
      parentObj.registersHL =
        (parentObj.registersHL & 0xff00) |
        (parentObj.FCarry ? 0x80 : 0) |
        ((parentObj.registersHL & 0xff) >> 1);
      parentObj.FCarry = newFCarry;
      parentObj.FHalfCarry = parentObj.FSubtract = false;
      parentObj.FZero = (parentObj.registersHL & 0xff) == 0;
    },
    //RR (HL)
    //#0x1E:
    function(parentObj: GameBoyCore) {
      var temp_var = parentObj.memoryReader[parentObj.registersHL](
        parentObj,
        parentObj.registersHL
      );
      var newFCarry = (temp_var & 0x01) == 0x01;
      temp_var = (parentObj.FCarry ? 0x80 : 0) | (temp_var >> 1);
      parentObj.FCarry = newFCarry;
      parentObj.memoryWriter[parentObj.registersHL](
        parentObj,
        parentObj.registersHL,
        temp_var
      );
      parentObj.FHalfCarry = parentObj.FSubtract = false;
      parentObj.FZero = temp_var == 0;
    },
    //RR A
    //#0x1F:
    function(parentObj: GameBoyCore) {
      var newFCarry = (parentObj.registerA & 0x01) == 0x01;
      parentObj.registerA =
        (parentObj.FCarry ? 0x80 : 0) | (parentObj.registerA >> 1);
      parentObj.FCarry = newFCarry;
      parentObj.FHalfCarry = parentObj.FSubtract = false;
      parentObj.FZero = parentObj.registerA == 0;
    },
    //SLA B
    //#0x20:
    function(parentObj: GameBoyCore) {
      parentObj.FCarry = parentObj.registerB > 0x7f;
      parentObj.registerB = (parentObj.registerB << 1) & 0xff;
      parentObj.FHalfCarry = parentObj.FSubtract = false;
      parentObj.FZero = parentObj.registerB == 0;
    },
    //SLA C
    //#0x21:
    function(parentObj: GameBoyCore) {
      parentObj.FCarry = parentObj.registerC > 0x7f;
      parentObj.registerC = (parentObj.registerC << 1) & 0xff;
      parentObj.FHalfCarry = parentObj.FSubtract = false;
      parentObj.FZero = parentObj.registerC == 0;
    },
    //SLA D
    //#0x22:
    function(parentObj: GameBoyCore) {
      parentObj.FCarry = parentObj.registerD > 0x7f;
      parentObj.registerD = (parentObj.registerD << 1) & 0xff;
      parentObj.FHalfCarry = parentObj.FSubtract = false;
      parentObj.FZero = parentObj.registerD == 0;
    },
    //SLA E
    //#0x23:
    function(parentObj: GameBoyCore) {
      parentObj.FCarry = parentObj.registerE > 0x7f;
      parentObj.registerE = (parentObj.registerE << 1) & 0xff;
      parentObj.FHalfCarry = parentObj.FSubtract = false;
      parentObj.FZero = parentObj.registerE == 0;
    },
    //SLA H
    //#0x24:
    function(parentObj: GameBoyCore) {
      parentObj.FCarry = parentObj.registersHL > 0x7fff;
      parentObj.registersHL =
        ((parentObj.registersHL << 1) & 0xfe00) |
        (parentObj.registersHL & 0xff);
      parentObj.FHalfCarry = parentObj.FSubtract = false;
      parentObj.FZero = parentObj.registersHL < 0x100;
    },
    //SLA L
    //#0x25:
    function(parentObj: GameBoyCore) {
      parentObj.FCarry = (parentObj.registersHL & 0x0080) == 0x0080;
      parentObj.registersHL =
        (parentObj.registersHL & 0xff00) |
        ((parentObj.registersHL << 1) & 0xff);
      parentObj.FHalfCarry = parentObj.FSubtract = false;
      parentObj.FZero = (parentObj.registersHL & 0xff) == 0;
    },
    //SLA (HL)
    //#0x26:
    function(parentObj: GameBoyCore) {
      var temp_var = parentObj.memoryReader[parentObj.registersHL](
        parentObj,
        parentObj.registersHL
      );
      parentObj.FCarry = temp_var > 0x7f;
      temp_var = (temp_var << 1) & 0xff;
      parentObj.memoryWriter[parentObj.registersHL](
        parentObj,
        parentObj.registersHL,
        temp_var
      );
      parentObj.FHalfCarry = parentObj.FSubtract = false;
      parentObj.FZero = temp_var == 0;
    },
    //SLA A
    //#0x27:
    function(parentObj: GameBoyCore) {
      parentObj.FCarry = parentObj.registerA > 0x7f;
      parentObj.registerA = (parentObj.registerA << 1) & 0xff;
      parentObj.FHalfCarry = parentObj.FSubtract = false;
      parentObj.FZero = parentObj.registerA == 0;
    },
    //SRA B
    //#0x28:
    function(parentObj: GameBoyCore) {
      parentObj.FCarry = (parentObj.registerB & 0x01) == 0x01;
      parentObj.registerB =
        (parentObj.registerB & 0x80) | (parentObj.registerB >> 1);
      parentObj.FHalfCarry = parentObj.FSubtract = false;
      parentObj.FZero = parentObj.registerB == 0;
    },
    //SRA C
    //#0x29:
    function(parentObj: GameBoyCore) {
      parentObj.FCarry = (parentObj.registerC & 0x01) == 0x01;
      parentObj.registerC =
        (parentObj.registerC & 0x80) | (parentObj.registerC >> 1);
      parentObj.FHalfCarry = parentObj.FSubtract = false;
      parentObj.FZero = parentObj.registerC == 0;
    },
    //SRA D
    //#0x2A:
    function(parentObj: GameBoyCore) {
      parentObj.FCarry = (parentObj.registerD & 0x01) == 0x01;
      parentObj.registerD =
        (parentObj.registerD & 0x80) | (parentObj.registerD >> 1);
      parentObj.FHalfCarry = parentObj.FSubtract = false;
      parentObj.FZero = parentObj.registerD == 0;
    },
    //SRA E
    //#0x2B:
    function(parentObj: GameBoyCore) {
      parentObj.FCarry = (parentObj.registerE & 0x01) == 0x01;
      parentObj.registerE =
        (parentObj.registerE & 0x80) | (parentObj.registerE >> 1);
      parentObj.FHalfCarry = parentObj.FSubtract = false;
      parentObj.FZero = parentObj.registerE == 0;
    },
    //SRA H
    //#0x2C:
    function(parentObj: GameBoyCore) {
      parentObj.FCarry = (parentObj.registersHL & 0x0100) == 0x0100;
      parentObj.registersHL =
        ((parentObj.registersHL >> 1) & 0xff00) |
        (parentObj.registersHL & 0x80ff);
      parentObj.FHalfCarry = parentObj.FSubtract = false;
      parentObj.FZero = parentObj.registersHL < 0x100;
    },
    //SRA L
    //#0x2D:
    function(parentObj: GameBoyCore) {
      parentObj.FCarry = (parentObj.registersHL & 0x0001) == 0x0001;
      parentObj.registersHL =
        (parentObj.registersHL & 0xff80) |
        ((parentObj.registersHL & 0xff) >> 1);
      parentObj.FHalfCarry = parentObj.FSubtract = false;
      parentObj.FZero = (parentObj.registersHL & 0xff) == 0;
    },
    //SRA (HL)
    //#0x2E:
    function(parentObj: GameBoyCore) {
      var temp_var = parentObj.memoryReader[parentObj.registersHL](
        parentObj,
        parentObj.registersHL
      );
      parentObj.FCarry = (temp_var & 0x01) == 0x01;
      temp_var = (temp_var & 0x80) | (temp_var >> 1);
      parentObj.memoryWriter[parentObj.registersHL](
        parentObj,
        parentObj.registersHL,
        temp_var
      );
      parentObj.FHalfCarry = parentObj.FSubtract = false;
      parentObj.FZero = temp_var == 0;
    },
    //SRA A
    //#0x2F:
    function(parentObj: GameBoyCore) {
      parentObj.FCarry = (parentObj.registerA & 0x01) == 0x01;
      parentObj.registerA =
        (parentObj.registerA & 0x80) | (parentObj.registerA >> 1);
      parentObj.FHalfCarry = parentObj.FSubtract = false;
      parentObj.FZero = parentObj.registerA == 0;
    },
    //SWAP B
    //#0x30:
    function(parentObj: GameBoyCore) {
      parentObj.registerB =
        ((parentObj.registerB & 0xf) << 4) | (parentObj.registerB >> 4);
      parentObj.FZero = parentObj.registerB == 0;
      parentObj.FCarry = parentObj.FHalfCarry = parentObj.FSubtract = false;
    },
    //SWAP C
    //#0x31:
    function(parentObj: GameBoyCore) {
      parentObj.registerC =
        ((parentObj.registerC & 0xf) << 4) | (parentObj.registerC >> 4);
      parentObj.FZero = parentObj.registerC == 0;
      parentObj.FCarry = parentObj.FHalfCarry = parentObj.FSubtract = false;
    },
    //SWAP D
    //#0x32:
    function(parentObj: GameBoyCore) {
      parentObj.registerD =
        ((parentObj.registerD & 0xf) << 4) | (parentObj.registerD >> 4);
      parentObj.FZero = parentObj.registerD == 0;
      parentObj.FCarry = parentObj.FHalfCarry = parentObj.FSubtract = false;
    },
    //SWAP E
    //#0x33:
    function(parentObj: GameBoyCore) {
      parentObj.registerE =
        ((parentObj.registerE & 0xf) << 4) | (parentObj.registerE >> 4);
      parentObj.FZero = parentObj.registerE == 0;
      parentObj.FCarry = parentObj.FHalfCarry = parentObj.FSubtract = false;
    },
    //SWAP H
    //#0x34:
    function(parentObj: GameBoyCore) {
      parentObj.registersHL =
        ((parentObj.registersHL & 0xf00) << 4) |
        ((parentObj.registersHL & 0xf000) >> 4) |
        (parentObj.registersHL & 0xff);
      parentObj.FZero = parentObj.registersHL < 0x100;
      parentObj.FCarry = parentObj.FHalfCarry = parentObj.FSubtract = false;
    },
    //SWAP L
    //#0x35:
    function(parentObj: GameBoyCore) {
      parentObj.registersHL =
        (parentObj.registersHL & 0xff00) |
        ((parentObj.registersHL & 0xf) << 4) |
        ((parentObj.registersHL & 0xf0) >> 4);
      parentObj.FZero = (parentObj.registersHL & 0xff) == 0;
      parentObj.FCarry = parentObj.FHalfCarry = parentObj.FSubtract = false;
    },
    //SWAP (HL)
    //#0x36:
    function(parentObj: GameBoyCore) {
      var temp_var = parentObj.memoryReader[parentObj.registersHL](
        parentObj,
        parentObj.registersHL
      );
      temp_var = ((temp_var & 0xf) << 4) | (temp_var >> 4);
      parentObj.memoryWriter[parentObj.registersHL](
        parentObj,
        parentObj.registersHL,
        temp_var
      );
      parentObj.FZero = temp_var == 0;
      parentObj.FCarry = parentObj.FHalfCarry = parentObj.FSubtract = false;
    },
    //SWAP A
    //#0x37:
    function(parentObj: GameBoyCore) {
      parentObj.registerA =
        ((parentObj.registerA & 0xf) << 4) | (parentObj.registerA >> 4);
      parentObj.FZero = parentObj.registerA == 0;
      parentObj.FCarry = parentObj.FHalfCarry = parentObj.FSubtract = false;
    },
    //SRL B
    //#0x38:
    function(parentObj: GameBoyCore) {
      parentObj.FCarry = (parentObj.registerB & 0x01) == 0x01;
      parentObj.registerB >>= 1;
      parentObj.FHalfCarry = parentObj.FSubtract = false;
      parentObj.FZero = parentObj.registerB == 0;
    },
    //SRL C
    //#0x39:
    function(parentObj: GameBoyCore) {
      parentObj.FCarry = (parentObj.registerC & 0x01) == 0x01;
      parentObj.registerC >>= 1;
      parentObj.FHalfCarry = parentObj.FSubtract = false;
      parentObj.FZero = parentObj.registerC == 0;
    },
    //SRL D
    //#0x3A:
    function(parentObj: GameBoyCore) {
      parentObj.FCarry = (parentObj.registerD & 0x01) == 0x01;
      parentObj.registerD >>= 1;
      parentObj.FHalfCarry = parentObj.FSubtract = false;
      parentObj.FZero = parentObj.registerD == 0;
    },
    //SRL E
    //#0x3B:
    function(parentObj: GameBoyCore) {
      parentObj.FCarry = (parentObj.registerE & 0x01) == 0x01;
      parentObj.registerE >>= 1;
      parentObj.FHalfCarry = parentObj.FSubtract = false;
      parentObj.FZero = parentObj.registerE == 0;
    },
    //SRL H
    //#0x3C:
    function(parentObj: GameBoyCore) {
      parentObj.FCarry = (parentObj.registersHL & 0x0100) == 0x0100;
      parentObj.registersHL =
        ((parentObj.registersHL >> 1) & 0xff00) |
        (parentObj.registersHL & 0xff);
      parentObj.FHalfCarry = parentObj.FSubtract = false;
      parentObj.FZero = parentObj.registersHL < 0x100;
    },
    //SRL L
    //#0x3D:
    function(parentObj: GameBoyCore) {
      parentObj.FCarry = (parentObj.registersHL & 0x0001) == 0x0001;
      parentObj.registersHL =
        (parentObj.registersHL & 0xff00) |
        ((parentObj.registersHL & 0xff) >> 1);
      parentObj.FHalfCarry = parentObj.FSubtract = false;
      parentObj.FZero = (parentObj.registersHL & 0xff) == 0;
    },
    //SRL (HL)
    //#0x3E:
    function(parentObj: GameBoyCore) {
      var temp_var = parentObj.memoryReader[parentObj.registersHL](
        parentObj,
        parentObj.registersHL
      );
      parentObj.FCarry = (temp_var & 0x01) == 0x01;
      parentObj.memoryWriter[parentObj.registersHL](
        parentObj,
        parentObj.registersHL,
        temp_var >> 1
      );
      parentObj.FHalfCarry = parentObj.FSubtract = false;
      parentObj.FZero = temp_var < 2;
    },
    //SRL A
    //#0x3F:
    function(parentObj: GameBoyCore) {
      parentObj.FCarry = (parentObj.registerA & 0x01) == 0x01;
      parentObj.registerA >>= 1;
      parentObj.FHalfCarry = parentObj.FSubtract = false;
      parentObj.FZero = parentObj.registerA == 0;
    },
    //BIT 0, B
    //#0x40:
    function(parentObj: GameBoyCore) {
      parentObj.FHalfCarry = true;
      parentObj.FSubtract = false;
      parentObj.FZero = (parentObj.registerB & 0x01) == 0;
    },
    //BIT 0, C
    //#0x41:
    function(parentObj: GameBoyCore) {
      parentObj.FHalfCarry = true;
      parentObj.FSubtract = false;
      parentObj.FZero = (parentObj.registerC & 0x01) == 0;
    },
    //BIT 0, D
    //#0x42:
    function(parentObj: GameBoyCore) {
      parentObj.FHalfCarry = true;
      parentObj.FSubtract = false;
      parentObj.FZero = (parentObj.registerD & 0x01) == 0;
    },
    //BIT 0, E
    //#0x43:
    function(parentObj: GameBoyCore) {
      parentObj.FHalfCarry = true;
      parentObj.FSubtract = false;
      parentObj.FZero = (parentObj.registerE & 0x01) == 0;
    },
    //BIT 0, H
    //#0x44:
    function(parentObj: GameBoyCore) {
      parentObj.FHalfCarry = true;
      parentObj.FSubtract = false;
      parentObj.FZero = (parentObj.registersHL & 0x0100) == 0;
    },
    //BIT 0, L
    //#0x45:
    function(parentObj: GameBoyCore) {
      parentObj.FHalfCarry = true;
      parentObj.FSubtract = false;
      parentObj.FZero = (parentObj.registersHL & 0x0001) == 0;
    },
    //BIT 0, (HL)
    //#0x46:
    function(parentObj: GameBoyCore) {
      parentObj.FHalfCarry = true;
      parentObj.FSubtract = false;
      parentObj.FZero =
        (parentObj.memoryReader[parentObj.registersHL](
          parentObj,
          parentObj.registersHL
        ) &
          0x01) ==
        0;
    },
    //BIT 0, A
    //#0x47:
    function(parentObj: GameBoyCore) {
      parentObj.FHalfCarry = true;
      parentObj.FSubtract = false;
      parentObj.FZero = (parentObj.registerA & 0x01) == 0;
    },
    //BIT 1, B
    //#0x48:
    function(parentObj: GameBoyCore) {
      parentObj.FHalfCarry = true;
      parentObj.FSubtract = false;
      parentObj.FZero = (parentObj.registerB & 0x02) == 0;
    },
    //BIT 1, C
    //#0x49:
    function(parentObj: GameBoyCore) {
      parentObj.FHalfCarry = true;
      parentObj.FSubtract = false;
      parentObj.FZero = (parentObj.registerC & 0x02) == 0;
    },
    //BIT 1, D
    //#0x4A:
    function(parentObj: GameBoyCore) {
      parentObj.FHalfCarry = true;
      parentObj.FSubtract = false;
      parentObj.FZero = (parentObj.registerD & 0x02) == 0;
    },
    //BIT 1, E
    //#0x4B:
    function(parentObj: GameBoyCore) {
      parentObj.FHalfCarry = true;
      parentObj.FSubtract = false;
      parentObj.FZero = (parentObj.registerE & 0x02) == 0;
    },
    //BIT 1, H
    //#0x4C:
    function(parentObj: GameBoyCore) {
      parentObj.FHalfCarry = true;
      parentObj.FSubtract = false;
      parentObj.FZero = (parentObj.registersHL & 0x0200) == 0;
    },
    //BIT 1, L
    //#0x4D:
    function(parentObj: GameBoyCore) {
      parentObj.FHalfCarry = true;
      parentObj.FSubtract = false;
      parentObj.FZero = (parentObj.registersHL & 0x0002) == 0;
    },
    //BIT 1, (HL)
    //#0x4E:
    function(parentObj: GameBoyCore) {
      parentObj.FHalfCarry = true;
      parentObj.FSubtract = false;
      parentObj.FZero =
        (parentObj.memoryReader[parentObj.registersHL](
          parentObj,
          parentObj.registersHL
        ) &
          0x02) ==
        0;
    },
    //BIT 1, A
    //#0x4F:
    function(parentObj: GameBoyCore) {
      parentObj.FHalfCarry = true;
      parentObj.FSubtract = false;
      parentObj.FZero = (parentObj.registerA & 0x02) == 0;
    },
    //BIT 2, B
    //#0x50:
    function(parentObj: GameBoyCore) {
      parentObj.FHalfCarry = true;
      parentObj.FSubtract = false;
      parentObj.FZero = (parentObj.registerB & 0x04) == 0;
    },
    //BIT 2, C
    //#0x51:
    function(parentObj: GameBoyCore) {
      parentObj.FHalfCarry = true;
      parentObj.FSubtract = false;
      parentObj.FZero = (parentObj.registerC & 0x04) == 0;
    },
    //BIT 2, D
    //#0x52:
    function(parentObj: GameBoyCore) {
      parentObj.FHalfCarry = true;
      parentObj.FSubtract = false;
      parentObj.FZero = (parentObj.registerD & 0x04) == 0;
    },
    //BIT 2, E
    //#0x53:
    function(parentObj: GameBoyCore) {
      parentObj.FHalfCarry = true;
      parentObj.FSubtract = false;
      parentObj.FZero = (parentObj.registerE & 0x04) == 0;
    },
    //BIT 2, H
    //#0x54:
    function(parentObj: GameBoyCore) {
      parentObj.FHalfCarry = true;
      parentObj.FSubtract = false;
      parentObj.FZero = (parentObj.registersHL & 0x0400) == 0;
    },
    //BIT 2, L
    //#0x55:
    function(parentObj: GameBoyCore) {
      parentObj.FHalfCarry = true;
      parentObj.FSubtract = false;
      parentObj.FZero = (parentObj.registersHL & 0x0004) == 0;
    },
    //BIT 2, (HL)
    //#0x56:
    function(parentObj: GameBoyCore) {
      parentObj.FHalfCarry = true;
      parentObj.FSubtract = false;
      parentObj.FZero =
        (parentObj.memoryReader[parentObj.registersHL](
          parentObj,
          parentObj.registersHL
        ) &
          0x04) ==
        0;
    },
    //BIT 2, A
    //#0x57:
    function(parentObj: GameBoyCore) {
      parentObj.FHalfCarry = true;
      parentObj.FSubtract = false;
      parentObj.FZero = (parentObj.registerA & 0x04) == 0;
    },
    //BIT 3, B
    //#0x58:
    function(parentObj: GameBoyCore) {
      parentObj.FHalfCarry = true;
      parentObj.FSubtract = false;
      parentObj.FZero = (parentObj.registerB & 0x08) == 0;
    },
    //BIT 3, C
    //#0x59:
    function(parentObj: GameBoyCore) {
      parentObj.FHalfCarry = true;
      parentObj.FSubtract = false;
      parentObj.FZero = (parentObj.registerC & 0x08) == 0;
    },
    //BIT 3, D
    //#0x5A:
    function(parentObj: GameBoyCore) {
      parentObj.FHalfCarry = true;
      parentObj.FSubtract = false;
      parentObj.FZero = (parentObj.registerD & 0x08) == 0;
    },
    //BIT 3, E
    //#0x5B:
    function(parentObj: GameBoyCore) {
      parentObj.FHalfCarry = true;
      parentObj.FSubtract = false;
      parentObj.FZero = (parentObj.registerE & 0x08) == 0;
    },
    //BIT 3, H
    //#0x5C:
    function(parentObj: GameBoyCore) {
      parentObj.FHalfCarry = true;
      parentObj.FSubtract = false;
      parentObj.FZero = (parentObj.registersHL & 0x0800) == 0;
    },
    //BIT 3, L
    //#0x5D:
    function(parentObj: GameBoyCore) {
      parentObj.FHalfCarry = true;
      parentObj.FSubtract = false;
      parentObj.FZero = (parentObj.registersHL & 0x0008) == 0;
    },
    //BIT 3, (HL)
    //#0x5E:
    function(parentObj: GameBoyCore) {
      parentObj.FHalfCarry = true;
      parentObj.FSubtract = false;
      parentObj.FZero =
        (parentObj.memoryReader[parentObj.registersHL](
          parentObj,
          parentObj.registersHL
        ) &
          0x08) ==
        0;
    },
    //BIT 3, A
    //#0x5F:
    function(parentObj: GameBoyCore) {
      parentObj.FHalfCarry = true;
      parentObj.FSubtract = false;
      parentObj.FZero = (parentObj.registerA & 0x08) == 0;
    },
    //BIT 4, B
    //#0x60:
    function(parentObj: GameBoyCore) {
      parentObj.FHalfCarry = true;
      parentObj.FSubtract = false;
      parentObj.FZero = (parentObj.registerB & 0x10) == 0;
    },
    //BIT 4, C
    //#0x61:
    function(parentObj: GameBoyCore) {
      parentObj.FHalfCarry = true;
      parentObj.FSubtract = false;
      parentObj.FZero = (parentObj.registerC & 0x10) == 0;
    },
    //BIT 4, D
    //#0x62:
    function(parentObj: GameBoyCore) {
      parentObj.FHalfCarry = true;
      parentObj.FSubtract = false;
      parentObj.FZero = (parentObj.registerD & 0x10) == 0;
    },
    //BIT 4, E
    //#0x63:
    function(parentObj: GameBoyCore) {
      parentObj.FHalfCarry = true;
      parentObj.FSubtract = false;
      parentObj.FZero = (parentObj.registerE & 0x10) == 0;
    },
    //BIT 4, H
    //#0x64:
    function(parentObj: GameBoyCore) {
      parentObj.FHalfCarry = true;
      parentObj.FSubtract = false;
      parentObj.FZero = (parentObj.registersHL & 0x1000) == 0;
    },
    //BIT 4, L
    //#0x65:
    function(parentObj: GameBoyCore) {
      parentObj.FHalfCarry = true;
      parentObj.FSubtract = false;
      parentObj.FZero = (parentObj.registersHL & 0x0010) == 0;
    },
    //BIT 4, (HL)
    //#0x66:
    function(parentObj: GameBoyCore) {
      parentObj.FHalfCarry = true;
      parentObj.FSubtract = false;
      parentObj.FZero =
        (parentObj.memoryReader[parentObj.registersHL](
          parentObj,
          parentObj.registersHL
        ) &
          0x10) ==
        0;
    },
    //BIT 4, A
    //#0x67:
    function(parentObj: GameBoyCore) {
      parentObj.FHalfCarry = true;
      parentObj.FSubtract = false;
      parentObj.FZero = (parentObj.registerA & 0x10) == 0;
    },
    //BIT 5, B
    //#0x68:
    function(parentObj: GameBoyCore) {
      parentObj.FHalfCarry = true;
      parentObj.FSubtract = false;
      parentObj.FZero = (parentObj.registerB & 0x20) == 0;
    },
    //BIT 5, C
    //#0x69:
    function(parentObj: GameBoyCore) {
      parentObj.FHalfCarry = true;
      parentObj.FSubtract = false;
      parentObj.FZero = (parentObj.registerC & 0x20) == 0;
    },
    //BIT 5, D
    //#0x6A:
    function(parentObj: GameBoyCore) {
      parentObj.FHalfCarry = true;
      parentObj.FSubtract = false;
      parentObj.FZero = (parentObj.registerD & 0x20) == 0;
    },
    //BIT 5, E
    //#0x6B:
    function(parentObj: GameBoyCore) {
      parentObj.FHalfCarry = true;
      parentObj.FSubtract = false;
      parentObj.FZero = (parentObj.registerE & 0x20) == 0;
    },
    //BIT 5, H
    //#0x6C:
    function(parentObj: GameBoyCore) {
      parentObj.FHalfCarry = true;
      parentObj.FSubtract = false;
      parentObj.FZero = (parentObj.registersHL & 0x2000) == 0;
    },
    //BIT 5, L
    //#0x6D:
    function(parentObj: GameBoyCore) {
      parentObj.FHalfCarry = true;
      parentObj.FSubtract = false;
      parentObj.FZero = (parentObj.registersHL & 0x0020) == 0;
    },
    //BIT 5, (HL)
    //#0x6E:
    function(parentObj: GameBoyCore) {
      parentObj.FHalfCarry = true;
      parentObj.FSubtract = false;
      parentObj.FZero =
        (parentObj.memoryReader[parentObj.registersHL](
          parentObj,
          parentObj.registersHL
        ) &
          0x20) ==
        0;
    },
    //BIT 5, A
    //#0x6F:
    function(parentObj: GameBoyCore) {
      parentObj.FHalfCarry = true;
      parentObj.FSubtract = false;
      parentObj.FZero = (parentObj.registerA & 0x20) == 0;
    },
    //BIT 6, B
    //#0x70:
    function(parentObj: GameBoyCore) {
      parentObj.FHalfCarry = true;
      parentObj.FSubtract = false;
      parentObj.FZero = (parentObj.registerB & 0x40) == 0;
    },
    //BIT 6, C
    //#0x71:
    function(parentObj: GameBoyCore) {
      parentObj.FHalfCarry = true;
      parentObj.FSubtract = false;
      parentObj.FZero = (parentObj.registerC & 0x40) == 0;
    },
    //BIT 6, D
    //#0x72:
    function(parentObj: GameBoyCore) {
      parentObj.FHalfCarry = true;
      parentObj.FSubtract = false;
      parentObj.FZero = (parentObj.registerD & 0x40) == 0;
    },
    //BIT 6, E
    //#0x73:
    function(parentObj: GameBoyCore) {
      parentObj.FHalfCarry = true;
      parentObj.FSubtract = false;
      parentObj.FZero = (parentObj.registerE & 0x40) == 0;
    },
    //BIT 6, H
    //#0x74:
    function(parentObj: GameBoyCore) {
      parentObj.FHalfCarry = true;
      parentObj.FSubtract = false;
      parentObj.FZero = (parentObj.registersHL & 0x4000) == 0;
    },
    //BIT 6, L
    //#0x75:
    function(parentObj: GameBoyCore) {
      parentObj.FHalfCarry = true;
      parentObj.FSubtract = false;
      parentObj.FZero = (parentObj.registersHL & 0x0040) == 0;
    },
    //BIT 6, (HL)
    //#0x76:
    function(parentObj: GameBoyCore) {
      parentObj.FHalfCarry = true;
      parentObj.FSubtract = false;
      parentObj.FZero =
        (parentObj.memoryReader[parentObj.registersHL](
          parentObj,
          parentObj.registersHL
        ) &
          0x40) ==
        0;
    },
    //BIT 6, A
    //#0x77:
    function(parentObj: GameBoyCore) {
      parentObj.FHalfCarry = true;
      parentObj.FSubtract = false;
      parentObj.FZero = (parentObj.registerA & 0x40) == 0;
    },
    //BIT 7, B
    //#0x78:
    function(parentObj: GameBoyCore) {
      parentObj.FHalfCarry = true;
      parentObj.FSubtract = false;
      parentObj.FZero = (parentObj.registerB & 0x80) == 0;
    },
    //BIT 7, C
    //#0x79:
    function(parentObj: GameBoyCore) {
      parentObj.FHalfCarry = true;
      parentObj.FSubtract = false;
      parentObj.FZero = (parentObj.registerC & 0x80) == 0;
    },
    //BIT 7, D
    //#0x7A:
    function(parentObj: GameBoyCore) {
      parentObj.FHalfCarry = true;
      parentObj.FSubtract = false;
      parentObj.FZero = (parentObj.registerD & 0x80) == 0;
    },
    //BIT 7, E
    //#0x7B:
    function(parentObj: GameBoyCore) {
      parentObj.FHalfCarry = true;
      parentObj.FSubtract = false;
      parentObj.FZero = (parentObj.registerE & 0x80) == 0;
    },
    //BIT 7, H
    //#0x7C:
    function(parentObj: GameBoyCore) {
      parentObj.FHalfCarry = true;
      parentObj.FSubtract = false;
      parentObj.FZero = (parentObj.registersHL & 0x8000) == 0;
    },
    //BIT 7, L
    //#0x7D:
    function(parentObj: GameBoyCore) {
      parentObj.FHalfCarry = true;
      parentObj.FSubtract = false;
      parentObj.FZero = (parentObj.registersHL & 0x0080) == 0;
    },
    //BIT 7, (HL)
    //#0x7E:
    function(parentObj: GameBoyCore) {
      parentObj.FHalfCarry = true;
      parentObj.FSubtract = false;
      parentObj.FZero =
        (parentObj.memoryReader[parentObj.registersHL](
          parentObj,
          parentObj.registersHL
        ) &
          0x80) ==
        0;
    },
    //BIT 7, A
    //#0x7F:
    function(parentObj: GameBoyCore) {
      parentObj.FHalfCarry = true;
      parentObj.FSubtract = false;
      parentObj.FZero = (parentObj.registerA & 0x80) == 0;
    },
    //RES 0, B
    //#0x80:
    function(parentObj: GameBoyCore) {
      parentObj.registerB &= 0xfe;
    },
    //RES 0, C
    //#0x81:
    function(parentObj: GameBoyCore) {
      parentObj.registerC &= 0xfe;
    },
    //RES 0, D
    //#0x82:
    function(parentObj: GameBoyCore) {
      parentObj.registerD &= 0xfe;
    },
    //RES 0, E
    //#0x83:
    function(parentObj: GameBoyCore) {
      parentObj.registerE &= 0xfe;
    },
    //RES 0, H
    //#0x84:
    function(parentObj: GameBoyCore) {
      parentObj.registersHL &= 0xfeff;
    },
    //RES 0, L
    //#0x85:
    function(parentObj: GameBoyCore) {
      parentObj.registersHL &= 0xfffe;
    },
    //RES 0, (HL)
    //#0x86:
    function(parentObj: GameBoyCore) {
      parentObj.memoryWriter[parentObj.registersHL](
        parentObj,
        parentObj.registersHL,
        parentObj.memoryReader[parentObj.registersHL](
          parentObj,
          parentObj.registersHL
        ) & 0xfe
      );
    },
    //RES 0, A
    //#0x87:
    function(parentObj: GameBoyCore) {
      parentObj.registerA &= 0xfe;
    },
    //RES 1, B
    //#0x88:
    function(parentObj: GameBoyCore) {
      parentObj.registerB &= 0xfd;
    },
    //RES 1, C
    //#0x89:
    function(parentObj: GameBoyCore) {
      parentObj.registerC &= 0xfd;
    },
    //RES 1, D
    //#0x8A:
    function(parentObj: GameBoyCore) {
      parentObj.registerD &= 0xfd;
    },
    //RES 1, E
    //#0x8B:
    function(parentObj: GameBoyCore) {
      parentObj.registerE &= 0xfd;
    },
    //RES 1, H
    //#0x8C:
    function(parentObj: GameBoyCore) {
      parentObj.registersHL &= 0xfdff;
    },
    //RES 1, L
    //#0x8D:
    function(parentObj: GameBoyCore) {
      parentObj.registersHL &= 0xfffd;
    },
    //RES 1, (HL)
    //#0x8E:
    function(parentObj: GameBoyCore) {
      parentObj.memoryWriter[parentObj.registersHL](
        parentObj,
        parentObj.registersHL,
        parentObj.memoryReader[parentObj.registersHL](
          parentObj,
          parentObj.registersHL
        ) & 0xfd
      );
    },
    //RES 1, A
    //#0x8F:
    function(parentObj: GameBoyCore) {
      parentObj.registerA &= 0xfd;
    },
    //RES 2, B
    //#0x90:
    function(parentObj: GameBoyCore) {
      parentObj.registerB &= 0xfb;
    },
    //RES 2, C
    //#0x91:
    function(parentObj: GameBoyCore) {
      parentObj.registerC &= 0xfb;
    },
    //RES 2, D
    //#0x92:
    function(parentObj: GameBoyCore) {
      parentObj.registerD &= 0xfb;
    },
    //RES 2, E
    //#0x93:
    function(parentObj: GameBoyCore) {
      parentObj.registerE &= 0xfb;
    },
    //RES 2, H
    //#0x94:
    function(parentObj: GameBoyCore) {
      parentObj.registersHL &= 0xfbff;
    },
    //RES 2, L
    //#0x95:
    function(parentObj: GameBoyCore) {
      parentObj.registersHL &= 0xfffb;
    },
    //RES 2, (HL)
    //#0x96:
    function(parentObj: GameBoyCore) {
      parentObj.memoryWriter[parentObj.registersHL](
        parentObj,
        parentObj.registersHL,
        parentObj.memoryReader[parentObj.registersHL](
          parentObj,
          parentObj.registersHL
        ) & 0xfb
      );
    },
    //RES 2, A
    //#0x97:
    function(parentObj: GameBoyCore) {
      parentObj.registerA &= 0xfb;
    },
    //RES 3, B
    //#0x98:
    function(parentObj: GameBoyCore) {
      parentObj.registerB &= 0xf7;
    },
    //RES 3, C
    //#0x99:
    function(parentObj: GameBoyCore) {
      parentObj.registerC &= 0xf7;
    },
    //RES 3, D
    //#0x9A:
    function(parentObj: GameBoyCore) {
      parentObj.registerD &= 0xf7;
    },
    //RES 3, E
    //#0x9B:
    function(parentObj: GameBoyCore) {
      parentObj.registerE &= 0xf7;
    },
    //RES 3, H
    //#0x9C:
    function(parentObj: GameBoyCore) {
      parentObj.registersHL &= 0xf7ff;
    },
    //RES 3, L
    //#0x9D:
    function(parentObj: GameBoyCore) {
      parentObj.registersHL &= 0xfff7;
    },
    //RES 3, (HL)
    //#0x9E:
    function(parentObj: GameBoyCore) {
      parentObj.memoryWriter[parentObj.registersHL](
        parentObj,
        parentObj.registersHL,
        parentObj.memoryReader[parentObj.registersHL](
          parentObj,
          parentObj.registersHL
        ) & 0xf7
      );
    },
    //RES 3, A
    //#0x9F:
    function(parentObj: GameBoyCore) {
      parentObj.registerA &= 0xf7;
    },
    //RES 3, B
    //#0xA0:
    function(parentObj: GameBoyCore) {
      parentObj.registerB &= 0xef;
    },
    //RES 4, C
    //#0xA1:
    function(parentObj: GameBoyCore) {
      parentObj.registerC &= 0xef;
    },
    //RES 4, D
    //#0xA2:
    function(parentObj: GameBoyCore) {
      parentObj.registerD &= 0xef;
    },
    //RES 4, E
    //#0xA3:
    function(parentObj: GameBoyCore) {
      parentObj.registerE &= 0xef;
    },
    //RES 4, H
    //#0xA4:
    function(parentObj: GameBoyCore) {
      parentObj.registersHL &= 0xefff;
    },
    //RES 4, L
    //#0xA5:
    function(parentObj: GameBoyCore) {
      parentObj.registersHL &= 0xffef;
    },
    //RES 4, (HL)
    //#0xA6:
    function(parentObj: GameBoyCore) {
      parentObj.memoryWriter[parentObj.registersHL](
        parentObj,
        parentObj.registersHL,
        parentObj.memoryReader[parentObj.registersHL](
          parentObj,
          parentObj.registersHL
        ) & 0xef
      );
    },
    //RES 4, A
    //#0xA7:
    function(parentObj: GameBoyCore) {
      parentObj.registerA &= 0xef;
    },
    //RES 5, B
    //#0xA8:
    function(parentObj: GameBoyCore) {
      parentObj.registerB &= 0xdf;
    },
    //RES 5, C
    //#0xA9:
    function(parentObj: GameBoyCore) {
      parentObj.registerC &= 0xdf;
    },
    //RES 5, D
    //#0xAA:
    function(parentObj: GameBoyCore) {
      parentObj.registerD &= 0xdf;
    },
    //RES 5, E
    //#0xAB:
    function(parentObj: GameBoyCore) {
      parentObj.registerE &= 0xdf;
    },
    //RES 5, H
    //#0xAC:
    function(parentObj: GameBoyCore) {
      parentObj.registersHL &= 0xdfff;
    },
    //RES 5, L
    //#0xAD:
    function(parentObj: GameBoyCore) {
      parentObj.registersHL &= 0xffdf;
    },
    //RES 5, (HL)
    //#0xAE:
    function(parentObj: GameBoyCore) {
      parentObj.memoryWriter[parentObj.registersHL](
        parentObj,
        parentObj.registersHL,
        parentObj.memoryReader[parentObj.registersHL](
          parentObj,
          parentObj.registersHL
        ) & 0xdf
      );
    },
    //RES 5, A
    //#0xAF:
    function(parentObj: GameBoyCore) {
      parentObj.registerA &= 0xdf;
    },
    //RES 6, B
    //#0xB0:
    function(parentObj: GameBoyCore) {
      parentObj.registerB &= 0xbf;
    },
    //RES 6, C
    //#0xB1:
    function(parentObj: GameBoyCore) {
      parentObj.registerC &= 0xbf;
    },
    //RES 6, D
    //#0xB2:
    function(parentObj: GameBoyCore) {
      parentObj.registerD &= 0xbf;
    },
    //RES 6, E
    //#0xB3:
    function(parentObj: GameBoyCore) {
      parentObj.registerE &= 0xbf;
    },
    //RES 6, H
    //#0xB4:
    function(parentObj: GameBoyCore) {
      parentObj.registersHL &= 0xbfff;
    },
    //RES 6, L
    //#0xB5:
    function(parentObj: GameBoyCore) {
      parentObj.registersHL &= 0xffbf;
    },
    //RES 6, (HL)
    //#0xB6:
    function(parentObj: GameBoyCore) {
      parentObj.memoryWriter[parentObj.registersHL](
        parentObj,
        parentObj.registersHL,
        parentObj.memoryReader[parentObj.registersHL](
          parentObj,
          parentObj.registersHL
        ) & 0xbf
      );
    },
    //RES 6, A
    //#0xB7:
    function(parentObj: GameBoyCore) {
      parentObj.registerA &= 0xbf;
    },
    //RES 7, B
    //#0xB8:
    function(parentObj: GameBoyCore) {
      parentObj.registerB &= 0x7f;
    },
    //RES 7, C
    //#0xB9:
    function(parentObj: GameBoyCore) {
      parentObj.registerC &= 0x7f;
    },
    //RES 7, D
    //#0xBA:
    function(parentObj: GameBoyCore) {
      parentObj.registerD &= 0x7f;
    },
    //RES 7, E
    //#0xBB:
    function(parentObj: GameBoyCore) {
      parentObj.registerE &= 0x7f;
    },
    //RES 7, H
    //#0xBC:
    function(parentObj: GameBoyCore) {
      parentObj.registersHL &= 0x7fff;
    },
    //RES 7, L
    //#0xBD:
    function(parentObj: GameBoyCore) {
      parentObj.registersHL &= 0xff7f;
    },
    //RES 7, (HL)
    //#0xBE:
    function(parentObj: GameBoyCore) {
      parentObj.memoryWriter[parentObj.registersHL](
        parentObj,
        parentObj.registersHL,
        parentObj.memoryReader[parentObj.registersHL](
          parentObj,
          parentObj.registersHL
        ) & 0x7f
      );
    },
    //RES 7, A
    //#0xBF:
    function(parentObj: GameBoyCore) {
      parentObj.registerA &= 0x7f;
    },
    //SET 0, B
    //#0xC0:
    function(parentObj: GameBoyCore) {
      parentObj.registerB |= 0x01;
    },
    //SET 0, C
    //#0xC1:
    function(parentObj: GameBoyCore) {
      parentObj.registerC |= 0x01;
    },
    //SET 0, D
    //#0xC2:
    function(parentObj: GameBoyCore) {
      parentObj.registerD |= 0x01;
    },
    //SET 0, E
    //#0xC3:
    function(parentObj: GameBoyCore) {
      parentObj.registerE |= 0x01;
    },
    //SET 0, H
    //#0xC4:
    function(parentObj: GameBoyCore) {
      parentObj.registersHL |= 0x0100;
    },
    //SET 0, L
    //#0xC5:
    function(parentObj: GameBoyCore) {
      parentObj.registersHL |= 0x01;
    },
    //SET 0, (HL)
    //#0xC6:
    function(parentObj: GameBoyCore) {
      parentObj.memoryWriter[parentObj.registersHL](
        parentObj,
        parentObj.registersHL,
        parentObj.memoryReader[parentObj.registersHL](
          parentObj,
          parentObj.registersHL
        ) | 0x01
      );
    },
    //SET 0, A
    //#0xC7:
    function(parentObj: GameBoyCore) {
      parentObj.registerA |= 0x01;
    },
    //SET 1, B
    //#0xC8:
    function(parentObj: GameBoyCore) {
      parentObj.registerB |= 0x02;
    },
    //SET 1, C
    //#0xC9:
    function(parentObj: GameBoyCore) {
      parentObj.registerC |= 0x02;
    },
    //SET 1, D
    //#0xCA:
    function(parentObj: GameBoyCore) {
      parentObj.registerD |= 0x02;
    },
    //SET 1, E
    //#0xCB:
    function(parentObj: GameBoyCore) {
      parentObj.registerE |= 0x02;
    },
    //SET 1, H
    //#0xCC:
    function(parentObj: GameBoyCore) {
      parentObj.registersHL |= 0x0200;
    },
    //SET 1, L
    //#0xCD:
    function(parentObj: GameBoyCore) {
      parentObj.registersHL |= 0x02;
    },
    //SET 1, (HL)
    //#0xCE:
    function(parentObj: GameBoyCore) {
      parentObj.memoryWriter[parentObj.registersHL](
        parentObj,
        parentObj.registersHL,
        parentObj.memoryReader[parentObj.registersHL](
          parentObj,
          parentObj.registersHL
        ) | 0x02
      );
    },
    //SET 1, A
    //#0xCF:
    function(parentObj: GameBoyCore) {
      parentObj.registerA |= 0x02;
    },
    //SET 2, B
    //#0xD0:
    function(parentObj: GameBoyCore) {
      parentObj.registerB |= 0x04;
    },
    //SET 2, C
    //#0xD1:
    function(parentObj: GameBoyCore) {
      parentObj.registerC |= 0x04;
    },
    //SET 2, D
    //#0xD2:
    function(parentObj: GameBoyCore) {
      parentObj.registerD |= 0x04;
    },
    //SET 2, E
    //#0xD3:
    function(parentObj: GameBoyCore) {
      parentObj.registerE |= 0x04;
    },
    //SET 2, H
    //#0xD4:
    function(parentObj: GameBoyCore) {
      parentObj.registersHL |= 0x0400;
    },
    //SET 2, L
    //#0xD5:
    function(parentObj: GameBoyCore) {
      parentObj.registersHL |= 0x04;
    },
    //SET 2, (HL)
    //#0xD6:
    function(parentObj: GameBoyCore) {
      parentObj.memoryWriter[parentObj.registersHL](
        parentObj,
        parentObj.registersHL,
        parentObj.memoryReader[parentObj.registersHL](
          parentObj,
          parentObj.registersHL
        ) | 0x04
      );
    },
    //SET 2, A
    //#0xD7:
    function(parentObj: GameBoyCore) {
      parentObj.registerA |= 0x04;
    },
    //SET 3, B
    //#0xD8:
    function(parentObj: GameBoyCore) {
      parentObj.registerB |= 0x08;
    },
    //SET 3, C
    //#0xD9:
    function(parentObj: GameBoyCore) {
      parentObj.registerC |= 0x08;
    },
    //SET 3, D
    //#0xDA:
    function(parentObj: GameBoyCore) {
      parentObj.registerD |= 0x08;
    },
    //SET 3, E
    //#0xDB:
    function(parentObj: GameBoyCore) {
      parentObj.registerE |= 0x08;
    },
    //SET 3, H
    //#0xDC:
    function(parentObj: GameBoyCore) {
      parentObj.registersHL |= 0x0800;
    },
    //SET 3, L
    //#0xDD:
    function(parentObj: GameBoyCore) {
      parentObj.registersHL |= 0x08;
    },
    //SET 3, (HL)
    //#0xDE:
    function(parentObj: GameBoyCore) {
      parentObj.memoryWriter[parentObj.registersHL](
        parentObj,
        parentObj.registersHL,
        parentObj.memoryReader[parentObj.registersHL](
          parentObj,
          parentObj.registersHL
        ) | 0x08
      );
    },
    //SET 3, A
    //#0xDF:
    function(parentObj: GameBoyCore) {
      parentObj.registerA |= 0x08;
    },
    //SET 4, B
    //#0xE0:
    function(parentObj: GameBoyCore) {
      parentObj.registerB |= 0x10;
    },
    //SET 4, C
    //#0xE1:
    function(parentObj: GameBoyCore) {
      parentObj.registerC |= 0x10;
    },
    //SET 4, D
    //#0xE2:
    function(parentObj: GameBoyCore) {
      parentObj.registerD |= 0x10;
    },
    //SET 4, E
    //#0xE3:
    function(parentObj: GameBoyCore) {
      parentObj.registerE |= 0x10;
    },
    //SET 4, H
    //#0xE4:
    function(parentObj: GameBoyCore) {
      parentObj.registersHL |= 0x1000;
    },
    //SET 4, L
    //#0xE5:
    function(parentObj: GameBoyCore) {
      parentObj.registersHL |= 0x10;
    },
    //SET 4, (HL)
    //#0xE6:
    function(parentObj: GameBoyCore) {
      parentObj.memoryWriter[parentObj.registersHL](
        parentObj,
        parentObj.registersHL,
        parentObj.memoryReader[parentObj.registersHL](
          parentObj,
          parentObj.registersHL
        ) | 0x10
      );
    },
    //SET 4, A
    //#0xE7:
    function(parentObj: GameBoyCore) {
      parentObj.registerA |= 0x10;
    },
    //SET 5, B
    //#0xE8:
    function(parentObj: GameBoyCore) {
      parentObj.registerB |= 0x20;
    },
    //SET 5, C
    //#0xE9:
    function(parentObj: GameBoyCore) {
      parentObj.registerC |= 0x20;
    },
    //SET 5, D
    //#0xEA:
    function(parentObj: GameBoyCore) {
      parentObj.registerD |= 0x20;
    },
    //SET 5, E
    //#0xEB:
    function(parentObj: GameBoyCore) {
      parentObj.registerE |= 0x20;
    },
    //SET 5, H
    //#0xEC:
    function(parentObj: GameBoyCore) {
      parentObj.registersHL |= 0x2000;
    },
    //SET 5, L
    //#0xED:
    function(parentObj: GameBoyCore) {
      parentObj.registersHL |= 0x20;
    },
    //SET 5, (HL)
    //#0xEE:
    function(parentObj: GameBoyCore) {
      parentObj.memoryWriter[parentObj.registersHL](
        parentObj,
        parentObj.registersHL,
        parentObj.memoryReader[parentObj.registersHL](
          parentObj,
          parentObj.registersHL
        ) | 0x20
      );
    },
    //SET 5, A
    //#0xEF:
    function(parentObj: GameBoyCore) {
      parentObj.registerA |= 0x20;
    },
    //SET 6, B
    //#0xF0:
    function(parentObj: GameBoyCore) {
      parentObj.registerB |= 0x40;
    },
    //SET 6, C
    //#0xF1:
    function(parentObj: GameBoyCore) {
      parentObj.registerC |= 0x40;
    },
    //SET 6, D
    //#0xF2:
    function(parentObj: GameBoyCore) {
      parentObj.registerD |= 0x40;
    },
    //SET 6, E
    //#0xF3:
    function(parentObj: GameBoyCore) {
      parentObj.registerE |= 0x40;
    },
    //SET 6, H
    //#0xF4:
    function(parentObj: GameBoyCore) {
      parentObj.registersHL |= 0x4000;
    },
    //SET 6, L
    //#0xF5:
    function(parentObj: GameBoyCore) {
      parentObj.registersHL |= 0x40;
    },
    //SET 6, (HL)
    //#0xF6:
    function(parentObj: GameBoyCore) {
      parentObj.memoryWriter[parentObj.registersHL](
        parentObj,
        parentObj.registersHL,
        parentObj.memoryReader[parentObj.registersHL](
          parentObj,
          parentObj.registersHL
        ) | 0x40
      );
    },
    //SET 6, A
    //#0xF7:
    function(parentObj: GameBoyCore) {
      parentObj.registerA |= 0x40;
    },
    //SET 7, B
    //#0xF8:
    function(parentObj: GameBoyCore) {
      parentObj.registerB |= 0x80;
    },
    //SET 7, C
    //#0xF9:
    function(parentObj: GameBoyCore) {
      parentObj.registerC |= 0x80;
    },
    //SET 7, D
    //#0xFA:
    function(parentObj: GameBoyCore) {
      parentObj.registerD |= 0x80;
    },
    //SET 7, E
    //#0xFB:
    function(parentObj: GameBoyCore) {
      parentObj.registerE |= 0x80;
    },
    //SET 7, H
    //#0xFC:
    function(parentObj: GameBoyCore) {
      parentObj.registersHL |= 0x8000;
    },
    //SET 7, L
    //#0xFD:
    function(parentObj: GameBoyCore) {
      parentObj.registersHL |= 0x80;
    },
    //SET 7, (HL)
    //#0xFE:
    function(parentObj: GameBoyCore) {
      parentObj.memoryWriter[parentObj.registersHL](
        parentObj,
        parentObj.registersHL,
        parentObj.memoryReader[parentObj.registersHL](
          parentObj,
          parentObj.registersHL
        ) | 0x80
      );
    },
    //SET 7, A
    //#0xFF:
    function(parentObj: GameBoyCore) {
      parentObj.registerA |= 0x80;
    }
  ];

  constructTickTable(array: number[]) {
    const table = new Uint8Array(array.length);

    for (let index = 0; index < array.length; index++) {
      table[index] = array[index];
    }

    return table;
  }

  TICKTable = this.constructTickTable([
    //Number of machine cycles for each instruction:
    /*   0,  1,  2,  3,  4,  5,  6,  7,      8,  9,  A, B,  C,  D, E,  F*/
    4,
    12,
    8,
    8,
    4,
    4,
    8,
    4,
    20,
    8,
    8,
    8,
    4,
    4,
    8,
    4, //0
    4,
    12,
    8,
    8,
    4,
    4,
    8,
    4,
    12,
    8,
    8,
    8,
    4,
    4,
    8,
    4, //1
    8,
    12,
    8,
    8,
    4,
    4,
    8,
    4,
    8,
    8,
    8,
    8,
    4,
    4,
    8,
    4, //2
    8,
    12,
    8,
    8,
    12,
    12,
    12,
    4,
    8,
    8,
    8,
    8,
    4,
    4,
    8,
    4, //3

    4,
    4,
    4,
    4,
    4,
    4,
    8,
    4,
    4,
    4,
    4,
    4,
    4,
    4,
    8,
    4, //4
    4,
    4,
    4,
    4,
    4,
    4,
    8,
    4,
    4,
    4,
    4,
    4,
    4,
    4,
    8,
    4, //5
    4,
    4,
    4,
    4,
    4,
    4,
    8,
    4,
    4,
    4,
    4,
    4,
    4,
    4,
    8,
    4, //6
    8,
    8,
    8,
    8,
    8,
    8,
    4,
    8,
    4,
    4,
    4,
    4,
    4,
    4,
    8,
    4, //7

    4,
    4,
    4,
    4,
    4,
    4,
    8,
    4,
    4,
    4,
    4,
    4,
    4,
    4,
    8,
    4, //8
    4,
    4,
    4,
    4,
    4,
    4,
    8,
    4,
    4,
    4,
    4,
    4,
    4,
    4,
    8,
    4, //9
    4,
    4,
    4,
    4,
    4,
    4,
    8,
    4,
    4,
    4,
    4,
    4,
    4,
    4,
    8,
    4, //A
    4,
    4,
    4,
    4,
    4,
    4,
    8,
    4,
    4,
    4,
    4,
    4,
    4,
    4,
    8,
    4, //B

    8,
    12,
    12,
    16,
    12,
    16,
    8,
    16,
    8,
    16,
    12,
    0,
    12,
    24,
    8,
    16, //C
    8,
    12,
    12,
    4,
    12,
    16,
    8,
    16,
    8,
    16,
    12,
    4,
    12,
    4,
    8,
    16, //D
    12,
    12,
    8,
    4,
    4,
    16,
    8,
    16,
    16,
    4,
    16,
    4,
    4,
    4,
    8,
    16, //E
    12,
    12,
    8,
    4,
    4,
    16,
    8,
    16,
    12,
    8,
    16,
    4,
    0,
    4,
    8,
    16 //F
  ]);

  SecondaryTICKTable = this.constructTickTable([
    //Number of machine cycles for each 0xCBXX instruction:
    /*  0, 1, 2, 3, 4, 5,  6, 7,        8, 9, A, B, C, D,  E, F*/
    8,
    8,
    8,
    8,
    8,
    8,
    16,
    8,
    8,
    8,
    8,
    8,
    8,
    8,
    16,
    8, //0
    8,
    8,
    8,
    8,
    8,
    8,
    16,
    8,
    8,
    8,
    8,
    8,
    8,
    8,
    16,
    8, //1
    8,
    8,
    8,
    8,
    8,
    8,
    16,
    8,
    8,
    8,
    8,
    8,
    8,
    8,
    16,
    8, //2
    8,
    8,
    8,
    8,
    8,
    8,
    16,
    8,
    8,
    8,
    8,
    8,
    8,
    8,
    16,
    8, //3

    8,
    8,
    8,
    8,
    8,
    8,
    12,
    8,
    8,
    8,
    8,
    8,
    8,
    8,
    12,
    8, //4
    8,
    8,
    8,
    8,
    8,
    8,
    12,
    8,
    8,
    8,
    8,
    8,
    8,
    8,
    12,
    8, //5
    8,
    8,
    8,
    8,
    8,
    8,
    12,
    8,
    8,
    8,
    8,
    8,
    8,
    8,
    12,
    8, //6
    8,
    8,
    8,
    8,
    8,
    8,
    12,
    8,
    8,
    8,
    8,
    8,
    8,
    8,
    12,
    8, //7

    8,
    8,
    8,
    8,
    8,
    8,
    16,
    8,
    8,
    8,
    8,
    8,
    8,
    8,
    16,
    8, //8
    8,
    8,
    8,
    8,
    8,
    8,
    16,
    8,
    8,
    8,
    8,
    8,
    8,
    8,
    16,
    8, //9
    8,
    8,
    8,
    8,
    8,
    8,
    16,
    8,
    8,
    8,
    8,
    8,
    8,
    8,
    16,
    8, //A
    8,
    8,
    8,
    8,
    8,
    8,
    16,
    8,
    8,
    8,
    8,
    8,
    8,
    8,
    16,
    8, //B

    8,
    8,
    8,
    8,
    8,
    8,
    16,
    8,
    8,
    8,
    8,
    8,
    8,
    8,
    16,
    8, //C
    8,
    8,
    8,
    8,
    8,
    8,
    16,
    8,
    8,
    8,
    8,
    8,
    8,
    8,
    16,
    8, //D
    8,
    8,
    8,
    8,
    8,
    8,
    16,
    8,
    8,
    8,
    8,
    8,
    8,
    8,
    16,
    8, //E
    8,
    8,
    8,
    8,
    8,
    8,
    16,
    8,
    8,
    8,
    8,
    8,
    8,
    8,
    16,
    8 //F
  ]);

  saveSRAMState() {
    if (!this.cBATT || this.MBCRam.length == 0) {
      //No battery backup...
      return new Uint8Array(0);
    } else {
      //Return the MBC RAM for backup...
      return this.MBCRam.slice(0);
    }
  }

  saveRTCState() {
    if (!this.cTIMER) {
      //No realtime clock...
      return [];
    } else {
      //Return the realtime clock for backup...
      return [
        this.lastIteration,
        this.RTCisLatched,
        this.latchedSeconds,
        this.latchedMinutes,
        this.latchedHours,
        this.latchedLDays,
        this.latchedHDays,
        this.RTCSeconds,
        this.RTCMinutes,
        this.RTCHours,
        this.RTCDays,
        this.RTCDayOverFlow,
        this.cTIMER
      ];
    }
  }

  saveState() {
    const sram = this.MBCRam.slice(0);

    const rtc = this.saveRTCState();

    const saveState = {
      state: [
        this.inBootstrap,
        this.registerA,
        this.FZero,
        this.FSubtract,
        this.FHalfCarry,
        this.FCarry,
        this.registerB,
        this.registerC,
        this.registerD,
        this.registerE,
        this.registersHL,
        this.stackPointer,
        this.programCounter,
        this.halt,
        this.IME,
        this.hdmaRunning,
        this.CPUTicks,
        this.doubleSpeedShifter,
        this.memory.slice(0),
        sram,
        this.VRAM.slice(0),
        this.currVRAMBank,
        this.GBCMemory.slice(0),
        this.MBC1Mode,
        this.MBCRAMBanksEnabled,
        this.currMBCRAMBank,
        this.currMBCRAMBankPosition,
        this.cGBC,
        this.gbcRamBank,
        this.gbcRamBankPosition,
        this.ROMBank1offs,
        this.currentROMBank,
        this.cartridgeType,
        this.name,
        this.gameCode,
        this.modeSTAT,
        this.LYCMatchTriggerSTAT,
        this.mode2TriggerSTAT,
        this.mode1TriggerSTAT,
        this.mode0TriggerSTAT,
        this.LCDisOn,
        this.gfxWindowCHRBankPosition,
        this.gfxWindowDisplay,
        this.gfxSpriteShow,
        this.gfxSpriteNormalHeight,
        this.gfxBackgroundCHRBankPosition,
        this.gfxBackgroundBankOffset,
        this.TIMAEnabled,
        this.DIVTicks,
        this.LCDTicks,
        this.timerTicks,
        this.TACClocker,
        this.serialTimer,
        this.serialShiftTimer,
        this.serialShiftTimerAllocated,
        this.IRQEnableDelay,
        this.lastIteration,
        this.cMBC1,
        this.cMBC2,
        this.cMBC3,
        this.cMBC5,
        this.cMBC7,
        this.cSRAM,
        this.cBATT,
        this.cMMMO1,
        this.cRUMBLE,
        this.cCamera,
        this.cTAMA5,
        this.cHuC3,
        this.cHuC1,
        this.drewBlank,
        this.frameBuffer.slice(0),
        this.bgEnabled,
        this.BGPriorityEnabled,
        this.channel1FrequencyTracker,
        this.channel1FrequencyCounter,
        this.channel1totalLength,
        this.channel1envelopeVolume,
        this.channel1envelopeType,
        this.channel1envelopeSweeps,
        this.channel1envelopeSweepsLast,
        this.channel1consecutive,
        this.channel1frequency,
        this.channel1SweepFault,
        this.channel1ShadowFrequency,
        this.channel1timeSweep,
        this.channel1lastTimeSweep,
        this.channel1Swept,
        this.channel1frequencySweepDivider,
        this.channel1decreaseSweep,
        this.channel2FrequencyTracker,
        this.channel2FrequencyCounter,
        this.channel2totalLength,
        this.channel2envelopeVolume,
        this.channel2envelopeType,
        this.channel2envelopeSweeps,
        this.channel2envelopeSweepsLast,
        this.channel2consecutive,
        this.channel2frequency,
        this.channel3canPlay,
        this.channel3totalLength,
        this.channel3patternType,
        this.channel3frequency,
        this.channel3consecutive,
        this.channel3PCM.slice(0),
        this.channel4FrequencyPeriod,
        this.channel4lastSampleLookup,
        this.channel4totalLength,
        this.channel4envelopeVolume,
        this.channel4currentVolume,
        this.channel4envelopeType,
        this.channel4envelopeSweeps,
        this.channel4envelopeSweepsLast,
        this.channel4consecutive,
        this.channel4BitRange,
        this.soundMasterEnabled,
        this.VinLeftChannelMasterVolume,
        this.VinRightChannelMasterVolume,
        this.leftChannel1,
        this.leftChannel2,
        this.leftChannel3,
        this.leftChannel4,
        this.rightChannel1,
        this.rightChannel2,
        this.rightChannel3,
        this.rightChannel4,
        this.channel1currentSampleLeft,
        this.channel1currentSampleRight,
        this.channel2currentSampleLeft,
        this.channel2currentSampleRight,
        this.channel3currentSampleLeft,
        this.channel3currentSampleRight,
        this.channel4currentSampleLeft,
        this.channel4currentSampleRight,
        this.channel1currentSampleLeftSecondary,
        this.channel1currentSampleRightSecondary,
        this.channel2currentSampleLeftSecondary,
        this.channel2currentSampleRightSecondary,
        this.channel3currentSampleLeftSecondary,
        this.channel3currentSampleRightSecondary,
        this.channel4currentSampleLeftSecondary,
        this.channel4currentSampleRightSecondary,
        this.channel1currentSampleLeftTrimary,
        this.channel1currentSampleRightTrimary,
        this.channel2currentSampleLeftTrimary,
        this.channel2currentSampleRightTrimary,
        this.mixerOutputCache,
        this.channel1DutyTracker,
        this.channel1CachedDuty,
        this.channel2DutyTracker,
        this.channel2CachedDuty,
        this.channel1Enabled,
        this.channel2Enabled,
        this.channel3Enabled,
        this.channel4Enabled,
        this.sequencerClocks,
        this.sequencePosition,
        this.channel3Counter,
        this.channel4Counter,
        this.cachedChannel3Sample,
        this.cachedChannel4Sample,
        this.channel3FrequencyPeriod,
        this.channel3lastSampleLookup,
        this.actualScanLine,
        this.lastUnrenderedLine,
        this.queuedScanLines,
        this.RTCisLatched,
        this.latchedSeconds,
        this.latchedMinutes,
        this.latchedHours,
        this.latchedLDays,
        this.latchedHDays,
        this.RTCSeconds,
        this.RTCMinutes,
        this.RTCHours,
        this.RTCDays,
        this.RTCDayOverFlow,
        this.cTIMER,
        this.usedBootROM,
        this.skipPCIncrement,
        this.STATTracker,
        this.gbcRamBankPositionECHO,
        this.numRAMBanks,
        this.windowY,
        this.windowX,
        this.gbcOBJRawPalette.slice(0),
        this.gbcBGRawPalette.slice(0),
        this.gbOBJPalette.slice(0),
        this.gbBGPalette.slice(0),
        this.gbcOBJPalette.slice(0),
        this.gbcBGPalette.slice(0),
        this.gbBGColorizedPalette.slice(0),
        this.gbOBJColorizedPalette.slice(0),
        this.cachedBGPaletteConversion.slice(0),
        this.cachedOBJPaletteConversion.slice(0),
        this.BGCHRBank1.slice(0),
        this.BGCHRBank2.slice(0),
        this.haltPostClocks,
        this.interruptsRequested,
        this.interruptsEnabled,
        this.remainingClocks,
        this.colorizedGBPalettes,
        this.backgroundY,
        this.backgroundX,
        this.CPUStopped,
        this.audioClocksUntilNextEvent,
        this.audioClocksUntilNextEventCounter
      ],

      sram,

      rtc
    };

    return saveState;
  }

  returnFromState(returnedFrom: any[], rewinding: boolean) {
    var index = 0;
    var state = returnedFrom.slice(0);
    this.ROMBankEdge = Math.floor(this.ROM.length / 0x4000);
    this.inBootstrap = state[index++];
    this.registerA = state[index++];
    this.FZero = state[index++];
    this.FSubtract = state[index++];
    this.FHalfCarry = state[index++];
    this.FCarry = state[index++];
    this.registerB = state[index++];
    this.registerC = state[index++];
    this.registerD = state[index++];
    this.registerE = state[index++];
    this.registersHL = state[index++];
    this.stackPointer = state[index++];
    this.programCounter = state[index++];
    this.halt = state[index++];
    this.IME = state[index++];
    this.hdmaRunning = state[index++];
    this.CPUTicks = state[index++];
    this.doubleSpeedShifter = state[index++];
    this.memory = state[index++];
    this.MBCRam = state[index++];
    this.VRAM = state[index++];
    this.currVRAMBank = state[index++];
    this.GBCMemory = state[index++];
    this.MBC1Mode = state[index++];
    this.MBCRAMBanksEnabled = state[index++];
    this.currMBCRAMBank = state[index++];
    this.currMBCRAMBankPosition = state[index++];
    this.cGBC = state[index++];
    this.gbcRamBank = state[index++];
    this.gbcRamBankPosition = state[index++];
    this.ROMBank1offs = state[index++];
    this.currentROMBank = state[index++];
    this.cartridgeType = state[index++];
    this.name = state[index++];
    this.gameCode = state[index++];
    this.modeSTAT = state[index++];
    this.LYCMatchTriggerSTAT = state[index++];
    this.mode2TriggerSTAT = state[index++];
    this.mode1TriggerSTAT = state[index++];
    this.mode0TriggerSTAT = state[index++];
    this.LCDisOn = state[index++];
    this.gfxWindowCHRBankPosition = state[index++];
    this.gfxWindowDisplay = state[index++];
    this.gfxSpriteShow = state[index++];
    this.gfxSpriteNormalHeight = state[index++];
    this.gfxBackgroundCHRBankPosition = state[index++];
    this.gfxBackgroundBankOffset = state[index++];
    this.TIMAEnabled = state[index++];
    this.DIVTicks = state[index++];
    this.LCDTicks = state[index++];
    this.timerTicks = state[index++];
    this.TACClocker = state[index++];
    this.serialTimer = state[index++];
    this.serialShiftTimer = state[index++];
    this.serialShiftTimerAllocated = state[index++];
    this.IRQEnableDelay = state[index++];
    this.lastIteration = state[index++];
    this.cMBC1 = state[index++];
    this.cMBC2 = state[index++];
    this.cMBC3 = state[index++];
    this.cMBC5 = state[index++];
    this.cMBC7 = state[index++];
    this.cSRAM = state[index++];
    this.cBATT = state[index++];
    this.cMMMO1 = state[index++];
    this.cRUMBLE = state[index++];
    this.cCamera = state[index++];
    this.cTAMA5 = state[index++];
    this.cHuC3 = state[index++];
    this.cHuC1 = state[index++];
    this.drewBlank = state[index++];
    this.frameBuffer = state[index++];
    this.bgEnabled = state[index++];
    this.BGPriorityEnabled = state[index++];
    this.channel1FrequencyTracker = state[index++];
    this.channel1FrequencyCounter = state[index++];
    this.channel1totalLength = state[index++];
    this.channel1envelopeVolume = state[index++];
    this.channel1envelopeType = state[index++];
    this.channel1envelopeSweeps = state[index++];
    this.channel1envelopeSweepsLast = state[index++];
    this.channel1consecutive = state[index++];
    this.channel1frequency = state[index++];
    this.channel1SweepFault = state[index++];
    this.channel1ShadowFrequency = state[index++];
    this.channel1timeSweep = state[index++];
    this.channel1lastTimeSweep = state[index++];
    this.channel1Swept = state[index++];
    this.channel1frequencySweepDivider = state[index++];
    this.channel1decreaseSweep = state[index++];
    this.channel2FrequencyTracker = state[index++];
    this.channel2FrequencyCounter = state[index++];
    this.channel2totalLength = state[index++];
    this.channel2envelopeVolume = state[index++];
    this.channel2envelopeType = state[index++];
    this.channel2envelopeSweeps = state[index++];
    this.channel2envelopeSweepsLast = state[index++];
    this.channel2consecutive = state[index++];
    this.channel2frequency = state[index++];
    this.channel3canPlay = state[index++];
    this.channel3totalLength = state[index++];
    this.channel3patternType = state[index++];
    this.channel3frequency = state[index++];
    this.channel3consecutive = state[index++];
    this.channel3PCM = state[index++];
    this.channel4FrequencyPeriod = state[index++];
    this.channel4lastSampleLookup = state[index++];
    this.channel4totalLength = state[index++];
    this.channel4envelopeVolume = state[index++];
    this.channel4currentVolume = state[index++];
    this.channel4envelopeType = state[index++];
    this.channel4envelopeSweeps = state[index++];
    this.channel4envelopeSweepsLast = state[index++];
    this.channel4consecutive = state[index++];
    this.channel4BitRange = state[index++];
    this.soundMasterEnabled = state[index++];
    this.VinLeftChannelMasterVolume = state[index++];
    this.VinRightChannelMasterVolume = state[index++];
    this.leftChannel1 = state[index++];
    this.leftChannel2 = state[index++];
    this.leftChannel3 = state[index++];
    this.leftChannel4 = state[index++];
    this.rightChannel1 = state[index++];
    this.rightChannel2 = state[index++];
    this.rightChannel3 = state[index++];
    this.rightChannel4 = state[index++];
    this.channel1currentSampleLeft = state[index++];
    this.channel1currentSampleRight = state[index++];
    this.channel2currentSampleLeft = state[index++];
    this.channel2currentSampleRight = state[index++];
    this.channel3currentSampleLeft = state[index++];
    this.channel3currentSampleRight = state[index++];
    this.channel4currentSampleLeft = state[index++];
    this.channel4currentSampleRight = state[index++];
    this.channel1currentSampleLeftSecondary = state[index++];
    this.channel1currentSampleRightSecondary = state[index++];
    this.channel2currentSampleLeftSecondary = state[index++];
    this.channel2currentSampleRightSecondary = state[index++];
    this.channel3currentSampleLeftSecondary = state[index++];
    this.channel3currentSampleRightSecondary = state[index++];
    this.channel4currentSampleLeftSecondary = state[index++];
    this.channel4currentSampleRightSecondary = state[index++];
    this.channel1currentSampleLeftTrimary = state[index++];
    this.channel1currentSampleRightTrimary = state[index++];
    this.channel2currentSampleLeftTrimary = state[index++];
    this.channel2currentSampleRightTrimary = state[index++];
    this.mixerOutputCache = state[index++];
    this.channel1DutyTracker = state[index++];
    this.channel1CachedDuty = state[index++];
    this.channel2DutyTracker = state[index++];
    this.channel2CachedDuty = state[index++];
    this.channel1Enabled = state[index++];
    this.channel2Enabled = state[index++];
    this.channel3Enabled = state[index++];
    this.channel4Enabled = state[index++];
    this.sequencerClocks = state[index++];
    this.sequencePosition = state[index++];
    this.channel3Counter = state[index++];
    this.channel4Counter = state[index++];
    this.cachedChannel3Sample = state[index++];
    this.cachedChannel4Sample = state[index++];
    this.channel3FrequencyPeriod = state[index++];
    this.channel3lastSampleLookup = state[index++];
    this.actualScanLine = state[index++];
    this.lastUnrenderedLine = state[index++];
    this.queuedScanLines = state[index++];
    this.RTCisLatched = state[index++];
    this.latchedSeconds = state[index++];
    this.latchedMinutes = state[index++];
    this.latchedHours = state[index++];
    this.latchedLDays = state[index++];
    this.latchedHDays = state[index++];
    this.RTCSeconds = state[index++];
    this.RTCMinutes = state[index++];
    this.RTCHours = state[index++];
    this.RTCDays = state[index++];
    this.RTCDayOverFlow = state[index++];
    this.cTIMER = state[index++];
    this.usedBootROM = state[index++];
    this.skipPCIncrement = state[index++];
    this.STATTracker = state[index++];
    this.gbcRamBankPositionECHO = state[index++];
    this.numRAMBanks = state[index++];
    this.windowY = state[index++];
    this.windowX = state[index++];
    this.gbcOBJRawPalette = state[index++];
    this.gbcBGRawPalette = state[index++];
    this.gbOBJPalette = state[index++];
    this.gbBGPalette = state[index++];
    this.gbcOBJPalette = state[index++];
    this.gbcBGPalette = state[index++];
    this.gbBGColorizedPalette = state[index++];
    this.gbOBJColorizedPalette = state[index++];
    this.cachedBGPaletteConversion = state[index++];
    this.cachedOBJPaletteConversion = state[index++];
    this.BGCHRBank1 = state[index++];
    this.BGCHRBank2 = state[index++];
    this.haltPostClocks = state[index++];
    this.interruptsRequested = state[index++];
    this.interruptsEnabled = state[index++];
    this.checkIRQMatching();
    this.remainingClocks = state[index++];
    this.colorizedGBPalettes = state[index++];
    this.backgroundY = state[index++];
    this.backgroundX = state[index++];
    this.CPUStopped = state[index++];
    this.audioClocksUntilNextEvent = state[index++];
    this.audioClocksUntilNextEventCounter = state[index];
    this.fromSaveState = true;
    this.TICKTable = this.TICKTable;
    this.SecondaryTICKTable = this.SecondaryTICKTable;
    this.initializeReferencesFromSaveState();
    if (!rewinding) {
      this.memoryReadJumpCompile();
      this.memoryWriteJumpCompile();
      this.initLCD();
      this.initSound();
    }
    this.noiseSampleTable =
      this.channel4BitRange == 0x7fff ? this.LSFR15Table : this.LSFR7Table;
    this.channel4VolumeShifter = this.channel4BitRange == 0x7fff ? 15 : 7;
  }

  returnFromRTCState() {
    if (typeof this.openRTC == "function" && this.cTIMER) {
      var rtcData = this.openRTC(this.name);
      var index = 0;
      this.lastIteration = rtcData[index++];
      this.RTCisLatched = rtcData[index++];
      this.latchedSeconds = rtcData[index++];
      this.latchedMinutes = rtcData[index++];
      this.latchedHours = rtcData[index++];
      this.latchedLDays = rtcData[index++];
      this.latchedHDays = rtcData[index++];
      this.RTCSeconds = rtcData[index++];
      this.RTCMinutes = rtcData[index++];
      this.RTCHours = rtcData[index++];
      this.RTCDays = rtcData[index++];
      this.RTCDayOverFlow = rtcData[index];
    }
  }

  start() {
    this.initMemory(); //Write the startup memory.
    this.ROMLoad(); //Load the ROM into memory and get cartridge information from it.
    this.initLCD(); //Initialize the graphics.
    this.initSound(); //Sound object initialization.
    this.run(false); //Start the emulation.
  }

  initMemory() {
    //Initialize the RAM:
    this.memory = new Uint8Array(0x10000);
    this.frameBuffer = new Int32Array(23040).fill(0xf8f8f8);
    this.BGCHRBank1 = new Uint8Array(0x800);
    this.channel3PCM = new Int8Array(0x20);
  }

  generateCacheArray(tileAmount: number) {
    var tileArray = [];
    var tileNumber = 0;
    while (tileNumber < tileAmount) {
      tileArray[tileNumber++] = new Uint8Array(64);
    }
    return tileArray;
  }

  initSkipBootstrap() {
    //Fill in the boot ROM set register values
    //Default values to the GB boot ROM values, then fill in the GBC boot ROM values after ROM loading
    var index = 0xff;
    while (index >= 0) {
      if (index >= 0x30 && index < 0x40) {
        this.memoryWrite(0xff00 | index, this.ffxxDump[index]);
      } else {
        switch (index) {
          case 0x00:
          case 0x01:
          case 0x02:
          case 0x05:
          case 0x07:
          case 0x0f:
          case 0xff:
            this.memoryWrite(0xff00 | index, this.ffxxDump[index]);
            break;
          default:
            this.memory[0xff00 | index] = this.ffxxDump[index];
        }
      }
      --index;
    }
    if (this.cGBC) {
      this.memory[0xff6c] = 0xfe;
      this.memory[0xff74] = 0xfe;
    } else {
      this.memory[0xff48] = 0xff;
      this.memory[0xff49] = 0xff;
      this.memory[0xff6c] = 0xff;
      this.memory[0xff74] = 0xff;
    }
    //Start as an unset device:
    cout("Starting without the GBC boot ROM.", 0);
    this.registerA = this.cGBC ? 0x11 : 0x1;
    this.registerB = 0;
    this.registerC = 0x13;
    this.registerD = 0;
    this.registerE = 0xd8;
    this.FZero = true;
    this.FSubtract = false;
    this.FHalfCarry = true;
    this.FCarry = true;
    this.registersHL = 0x014d;
    this.LCDCONTROL = this.LINECONTROL;
    this.IME = false;
    this.IRQLineMatched = 0;
    this.interruptsRequested = 225;
    this.interruptsEnabled = 0;
    this.hdmaRunning = false;
    this.CPUTicks = 12;
    this.STATTracker = 0;
    this.modeSTAT = 1;
    this.spriteCount = 252;
    this.LYCMatchTriggerSTAT = false;
    this.mode2TriggerSTAT = false;
    this.mode1TriggerSTAT = false;
    this.mode0TriggerSTAT = false;
    this.LCDisOn = true;
    this.channel1FrequencyTracker = 0x2000;
    this.channel1DutyTracker = 0;
    this.channel1CachedDuty = this.dutyLookup[2];
    this.channel1totalLength = 0;
    this.channel1envelopeVolume = 0;
    this.channel1envelopeType = false;
    this.channel1envelopeSweeps = 0;
    this.channel1envelopeSweepsLast = 0;
    this.channel1consecutive = true;
    this.channel1frequency = 1985;
    this.channel1SweepFault = true;
    this.channel1ShadowFrequency = 1985;
    this.channel1timeSweep = 1;
    this.channel1lastTimeSweep = 0;
    this.channel1Swept = false;
    this.channel1frequencySweepDivider = 0;
    this.channel1decreaseSweep = false;
    this.channel2FrequencyTracker = 0x2000;
    this.channel2DutyTracker = 0;
    this.channel2CachedDuty = this.dutyLookup[2];
    this.channel2totalLength = 0;
    this.channel2envelopeVolume = 0;
    this.channel2envelopeType = false;
    this.channel2envelopeSweeps = 0;
    this.channel2envelopeSweepsLast = 0;
    this.channel2consecutive = true;
    this.channel2frequency = 0;
    this.channel3canPlay = false;
    this.channel3totalLength = 0;
    this.channel3patternType = 4;
    this.channel3frequency = 0;
    this.channel3consecutive = true;
    this.channel3Counter = 0x418;
    this.channel4FrequencyPeriod = 8;
    this.channel4totalLength = 0;
    this.channel4envelopeVolume = 0;
    this.channel4currentVolume = 0;
    this.channel4envelopeType = false;
    this.channel4envelopeSweeps = 0;
    this.channel4envelopeSweepsLast = 0;
    this.channel4consecutive = true;
    this.channel4BitRange = 0x7fff;
    this.channel4VolumeShifter = 15;
    this.channel1FrequencyCounter = 0x200;
    this.channel2FrequencyCounter = 0x200;
    this.channel3Counter = 0x800;
    this.channel3FrequencyPeriod = 0x800;
    this.channel3lastSampleLookup = 0;
    this.channel4lastSampleLookup = 0;
    this.VinLeftChannelMasterVolume = 8;
    this.VinRightChannelMasterVolume = 8;
    this.soundMasterEnabled = true;
    this.leftChannel1 = true;
    this.leftChannel2 = true;
    this.leftChannel3 = true;
    this.leftChannel4 = true;
    this.rightChannel1 = true;
    this.rightChannel2 = true;
    this.rightChannel3 = false;
    this.rightChannel4 = false;
    this.DIVTicks = 27044;
    this.LCDTicks = 160;
    this.timerTicks = 0;
    this.TIMAEnabled = false;
    this.TACClocker = 1024;
    this.serialTimer = 0;
    this.serialShiftTimer = 0;
    this.serialShiftTimerAllocated = 0;
    this.IRQEnableDelay = 0;
    this.actualScanLine = 144;
    this.lastUnrenderedLine = 0;
    this.gfxWindowDisplay = false;
    this.gfxSpriteShow = false;
    this.gfxSpriteNormalHeight = true;
    this.bgEnabled = true;
    this.BGPriorityEnabled = true;
    this.gfxWindowCHRBankPosition = 0;
    this.gfxBackgroundCHRBankPosition = 0;
    this.gfxBackgroundBankOffset = 0;
    this.windowY = 0;
    this.windowX = 0;
    this.drewBlank = 0;
    this.midScanlineOffset = -1;
    this.currentX = 0;
  }

  initBootstrap() {
    //Start as an unset device:
    cout("Starting the selected boot ROM.", 0);
    this.programCounter = 0;
    this.stackPointer = 0;
    this.IME = false;
    this.LCDTicks = 0;
    this.DIVTicks = 0;
    this.registerA = 0;
    this.registerB = 0;
    this.registerC = 0;
    this.registerD = 0;
    this.registerE = 0;
    this.FZero = this.FSubtract = this.FHalfCarry = this.FCarry = false;
    this.registersHL = 0;
    this.leftChannel1 = false;
    this.leftChannel2 = false;
    this.leftChannel3 = false;
    this.leftChannel4 = false;
    this.rightChannel1 = false;
    this.rightChannel2 = false;
    this.rightChannel3 = false;
    this.rightChannel4 = false;
    this.channel2frequency = this.channel1frequency = 0;
    this.channel4consecutive = this.channel2consecutive = this.channel1consecutive = false;
    this.VinLeftChannelMasterVolume = 8;
    this.VinRightChannelMasterVolume = 8;
    this.memory[0xff00] = 0xf; //Set the joypad state.
  }

  ROMLoad() {
    //Load the first two ROM banks (0x0000 - 0x7FFF) into regular gameboy memory:
    this.ROM = new Uint8Array(0);
    this.usedBootROM = this.GBCBOOTROM.length == 0x800;
    var maxLength = this.ROMImage.length;
    if (maxLength < 0x4000) {
      throw new Error("ROM image size too small.");
    }
    this.ROM = new Uint8Array(maxLength);
    var romIndex = 0;
    if (this.usedBootROM) {
      //Patch in the GBC boot ROM into the memory map:
      for (; romIndex < 0x100; ++romIndex) {
        this.memory[romIndex] = this.GBCBOOTROM[romIndex]; //Load in the GameBoy Color BOOT ROM.
        this.ROM[romIndex] = this.ROMImage[romIndex]; //Decode the ROM binary for the switch out.
      }
      for (; romIndex < 0x200; ++romIndex) {
        this.memory[romIndex] = this.ROM[romIndex] = this.ROMImage[romIndex]; //Load in the game ROM.
      }
      for (; romIndex < 0x900; ++romIndex) {
        this.memory[romIndex] = this.GBCBOOTROM[romIndex - 0x100]; //Load in the GameBoy Color BOOT ROM.
        this.ROM[romIndex] = this.ROMImage[romIndex]; //Decode the ROM binary for the switch out.
      }
      this.usedGBCBootROM = true;

      for (; romIndex < 0x4000; ++romIndex) {
        this.memory[romIndex] = this.ROM[romIndex] = this.ROMImage[romIndex]; //Load in the game ROM.
      }
    } else {
      //Don't load in the boot ROM:
      for (; romIndex < 0x4000; ++romIndex) {
        this.memory[romIndex] = this.ROM[romIndex] = this.ROMImage[romIndex]; //Load in the game ROM.
      }
    }
    //Finish the decoding of the ROM binary:
    for (; romIndex < maxLength; ++romIndex) {
      this.ROM[romIndex] = this.ROMImage[romIndex];
    }
    this.ROMBankEdge = Math.floor(this.ROM.length / 0x4000);
    //Set up the emulator for the cartidge specifics:
    this.interpretCartridge();
    //Check for IRQ matching upon initialization:
    this.checkIRQMatching();
  }

  interpretCartridge() {
    cout(
      "Game Title: " +
        this.name +
        "[" +
        this.gameCode +
        "][" +
        this.ROMImage[0x143] +
        "]",
      0
    );
    cout("Game Code: " + this.gameCode, 0);
    // Cartridge type
    this.cartridgeType = this.ROM[0x147];
    cout("Cartridge type #" + this.cartridgeType, 0);
    //Map out ROM cartridge sub-types.
    var MBCType = "";
    switch (this.cartridgeType) {
      case 0x00:
        //ROM w/o bank switching
        MBCType = "ROM";
        break;
      case 0x01:
        this.cMBC1 = true;
        MBCType = "MBC1";
        break;
      case 0x02:
        this.cMBC1 = true;
        this.cSRAM = true;
        MBCType = "MBC1 + SRAM";
        break;
      case 0x03:
        this.cMBC1 = true;
        this.cSRAM = true;
        this.cBATT = true;
        MBCType = "MBC1 + SRAM + BATT";
        break;
      case 0x05:
        this.cMBC2 = true;
        MBCType = "MBC2";
        break;
      case 0x06:
        this.cMBC2 = true;
        this.cBATT = true;
        MBCType = "MBC2 + BATT";
        break;
      case 0x08:
        this.cSRAM = true;
        MBCType = "ROM + SRAM";
        break;
      case 0x09:
        this.cSRAM = true;
        this.cBATT = true;
        MBCType = "ROM + SRAM + BATT";
        break;
      case 0x0b:
        this.cMMMO1 = true;
        MBCType = "MMMO1";
        break;
      case 0x0c:
        this.cMMMO1 = true;
        this.cSRAM = true;
        MBCType = "MMMO1 + SRAM";
        break;
      case 0x0d:
        this.cMMMO1 = true;
        this.cSRAM = true;
        this.cBATT = true;
        MBCType = "MMMO1 + SRAM + BATT";
        break;
      case 0x0f:
        this.cMBC3 = true;
        this.cTIMER = true;
        this.cBATT = true;
        MBCType = "MBC3 + TIMER + BATT";
        break;
      case 0x10:
        this.cMBC3 = true;
        this.cTIMER = true;
        this.cBATT = true;
        this.cSRAM = true;
        MBCType = "MBC3 + TIMER + BATT + SRAM";
        break;
      case 0x11:
        this.cMBC3 = true;
        MBCType = "MBC3";
        break;
      case 0x12:
        this.cMBC3 = true;
        this.cSRAM = true;
        MBCType = "MBC3 + SRAM";
        break;
      case 0x13:
        this.cMBC3 = true;
        this.cSRAM = true;
        this.cBATT = true;
        MBCType = "MBC3 + SRAM + BATT";
        break;
      case 0x19:
        this.cMBC5 = true;
        MBCType = "MBC5";
        break;
      case 0x1a:
        this.cMBC5 = true;
        this.cSRAM = true;
        MBCType = "MBC5 + SRAM";
        break;
      case 0x1b:
        this.cMBC5 = true;
        this.cSRAM = true;
        this.cBATT = true;
        MBCType = "MBC5 + SRAM + BATT";
        break;
      case 0x1c:
        this.cRUMBLE = true;
        MBCType = "RUMBLE";
        break;
      case 0x1d:
        this.cRUMBLE = true;
        this.cSRAM = true;
        MBCType = "RUMBLE + SRAM";
        break;
      case 0x1e:
        this.cRUMBLE = true;
        this.cSRAM = true;
        this.cBATT = true;
        MBCType = "RUMBLE + SRAM + BATT";
        break;
      case 0x1f:
        this.cCamera = true;
        MBCType = "GameBoy Camera";
        break;
      case 0x22:
        this.cMBC7 = true;
        this.cSRAM = true;
        this.cBATT = true;
        MBCType = "MBC7 + SRAM + BATT";
        break;
      case 0xfd:
        this.cTAMA5 = true;
        MBCType = "TAMA5";
        break;
      case 0xfe:
        this.cHuC3 = true;
        MBCType = "HuC3";
        break;
      case 0xff:
        this.cHuC1 = true;
        MBCType = "HuC1";
        break;
      default:
        MBCType = "Unknown";
        cout("Cartridge type is unknown.", 2);
        pause();
    }
    cout("Cartridge Type: " + MBCType + ".", 0);
    // ROM and RAM banks
    this.numROMBanks = this.ROMBanks[this.ROM[0x148]];
    cout(this.numROMBanks + " ROM banks.", 0);
    switch (this.RAMBanks[this.ROM[0x149]]) {
      case 0:
        cout("No RAM banking requested for allocation or MBC is of type 2.", 0);
        break;
      case 2:
        cout("1 RAM bank requested for allocation.", 0);
        break;
      case 3:
        cout("4 RAM banks requested for allocation.", 0);
        break;
      case 4:
        cout("16 RAM banks requested for allocation.", 0);
        break;
      default:
        cout(
          "RAM bank amount requested is unknown, will use maximum allowed by specified MBC type.",
          0
        );
    }
    //Check the GB/GBC mode byte:
    if (!this.usedBootROM) {
      switch (this.ROM[0x143]) {
        case 0x00: //Only GB mode
          this.cGBC = false;
          cout("Only GB mode detected.", 0);
          break;
        case 0x32: //Exception to the GBC identifying code:
          if (
            this.name + this.gameCode + this.ROM[0x143] ==
            "Game and Watch 50"
          ) {
            this.cGBC = true;
            cout(
              "Created a boot exception for Game and Watch Gallery 2 (GBC ID byte is wrong on the cartridge).",
              1
            );
          } else {
            this.cGBC = false;
          }
          break;
        case 0x80: //Both GB + GBC modes
          this.cGBC = true;
          cout("GB and GBC mode detected.", 0);
          break;
        case 0xc0: //Only GBC mode
          this.cGBC = true;
          cout("Only GBC mode detected.", 0);
          break;
        default:
          this.cGBC = false;
          cout(
            "Unknown GameBoy game type code #" +
              this.ROM[0x143] +
              ", defaulting to GB mode (Old games don't have a type code).",
            1
          );
      }
      this.inBootstrap = false;
      this.setupRAM(); //CPU/(V)RAM initialization.
      this.initSkipBootstrap();
    } else {
      this.cGBC = this.usedGBCBootROM; //Allow the GBC boot ROM to run in GBC mode...
      this.setupRAM(); //CPU/(V)RAM initialization.
      this.initBootstrap();
    }
    this.initializeModeSpecificArrays();
    //License Code Lookup:
    var cOldLicense = this.ROM[0x14b];
    var cNewLicense = (this.ROM[0x144] & 0xff00) | (this.ROM[0x145] & 0xff);
    if (cOldLicense != 0x33) {
      //Old Style License Header
      cout("Old style license code: " + cOldLicense, 0);
    } else {
      //New Style License Header
      cout("New style license code: " + cNewLicense, 0);
    }
    this.ROMImage = new Uint8Array(0); //Memory consumption reduction.
  }

  disableBootROM() {
    //Remove any traces of the boot ROM from ROM memory.
    for (var index = 0; index < 0x100; ++index) {
      this.memory[index] = this.ROM[index]; //Replace the GameBoy or GameBoy Color boot ROM with the game ROM.
    }
    if (this.usedGBCBootROM) {
      //Remove any traces of the boot ROM from ROM memory.
      for (index = 0x200; index < 0x900; ++index) {
        this.memory[index] = this.ROM[index]; //Replace the GameBoy Color boot ROM with the game ROM.
      }
      if (!this.cGBC) {
        //Clean up the post-boot (GB mode only) state:
        this.GBCtoGBModeAdjust();
      } else {
        this.recompileBootIOWriteHandling();
      }
    } else {
      this.recompileBootIOWriteHandling();
    }
  }

  initializeTiming() {
    //Emulator Timing:
    this.clocksPerSecond = this.emulatorSpeed * 0x400000;
    this.baseCPUCyclesPerIteration =
      (this.clocksPerSecond / 1000) * FRAME_INTERVAL;
    this.CPUCyclesTotalRoundoff = this.baseCPUCyclesPerIteration % 4;
    this.CPUCyclesTotalBase = this.CPUCyclesTotal =
      (this.baseCPUCyclesPerIteration - this.CPUCyclesTotalRoundoff) | 0;
    this.CPUCyclesTotalCurrent = 0;
  }

  setSpeed(speed: number) {
    this.emulatorSpeed = speed;
    this.initializeTiming();
    if (this.audioHandle) {
      this.initSound();
    }
  }

  setupRAM() {
    //Setup the auxilliary/switchable RAM:
    if (this.cMBC2) {
      this.numRAMBanks = 1 / 16;
    } else if (this.cMBC1 || this.cRUMBLE || this.cMBC3 || this.cHuC3) {
      this.numRAMBanks = 4;
    } else if (this.cMBC5) {
      this.numRAMBanks = 16;
    } else if (this.cSRAM) {
      this.numRAMBanks = 1;
    }
    if (this.numRAMBanks > 0) {
      if (!this.MBCRAMUtilized()) {
        //For ROM and unknown MBC cartridges using the external RAM:
        this.MBCRAMBanksEnabled = true;
      }
      //Switched RAM Used
      var MBCRam =
        typeof this.openMBC == "function"
          ? this.openMBC(this.name)
          : new Uint8Array(0);
      if (MBCRam.length > 0) {
        //Flash the SRAM into memory:
        this.MBCRam = MBCRam;
      } else {
        this.MBCRam = new Uint8Array(this.numRAMBanks * 0x2000);
      }
    }
    cout("Actual bytes of MBC RAM allocated: " + this.numRAMBanks * 0x2000, 0);
    this.returnFromRTCState();
    //Setup the RAM for GBC mode.
    if (this.cGBC) {
      this.VRAM = new Uint8Array(0x2000);
      this.GBCMemory = new Uint8Array(0x7000);
    }
    this.memoryReadJumpCompile();
    this.memoryWriteJumpCompile();
  }

  MBCRAMUtilized() {
    return (
      this.cMBC1 ||
      this.cMBC2 ||
      this.cMBC3 ||
      this.cMBC5 ||
      this.cMBC7 ||
      this.cRUMBLE
    );
  }

  initLCD() {
    //Get a CanvasPixelArray buffer:
    this.canvasBuffer = new Uint8ClampedArray(this.RGBCount);

    var index = this.RGBCount;
    while (index > 0) {
      this.canvasBuffer[(index -= 4)] = 0xf8;
      this.canvasBuffer[index + 1] = 0xf8;
      this.canvasBuffer[index + 2] = 0xf8;
      this.canvasBuffer[index + 3] = 0xff;
    }
    this.executeDraw();

    if (this.swizzledFrame == null) {
      this.swizzledFrame = new Uint8Array(69120).fill(0xff);
    }
    //Test the draw system and browser vblank latching:
    this.drewFrame = true; //Copy the latest graphics to buffer.
    this.requestDraw();
  }

  executeDraw() {
    renderingBuffer.set(this.canvasBuffer);
  }

  JoyPadEvent(key: number, down: boolean) {
    if (down) {
      this.JoyPad &= 0xff ^ (1 << key);
      if (!this.cGBC && (!this.usedBootROM || !this.usedGBCBootROM)) {
        this.interruptsRequested |= 0x10; //A real GBC doesn't set this!
        this.remainingClocks = 0;
        this.checkIRQMatching();
      }
    } else {
      this.JoyPad |= 1 << key;
    }
    this.memory[0xff00] =
      (this.memory[0xff00] & 0x30) +
      (((this.memory[0xff00] & 0x20) == 0 ? this.JoyPad >> 4 : 0xf) &
        ((this.memory[0xff00] & 0x10) == 0 ? this.JoyPad & 0xf : 0xf));
    this.CPUStopped = false;
  }

  GyroEvent(x: number, y: number) {
    x *= -100;
    x += 2047;
    this.highX = x >> 8;
    this.lowX = x & 0xff;
    y *= -100;
    y += 2047;
    this.highY = y >> 8;
    this.lowY = y & 0xff;
  }

  initSound() {
    this.audioResamplerFirstPassFactor = Math.max(
      Math.min(
        Math.floor(this.clocksPerSecond / 44100),
        Math.floor(0xffff / 0x1e0)
      ),
      1
    );
    this.downSampleInputDivider =
      1 / (this.audioResamplerFirstPassFactor * 0xf0);
    if (!this.muted) {
      this.audioHandle = new XAudioServer(
        2,
        this.clocksPerSecond / this.audioResamplerFirstPassFactor,
        0,
        Math.max(
          (this.baseCPUCyclesPerIteration * AUDIO_BUFFER_SPAN_MAX) /
            this.audioResamplerFirstPassFactor,
          8192
        ) << 1,
        1,
        undefined,
        () => {
          this.muted = true;
        }
      );
      this.initAudioBuffer();
    } else if (this.audioHandle) {
      //Mute the audio output, as it has an immediate silencing effect:
      this.audioHandle.changeVolume(0);
    }
  }

  stopSound() {
    if (this.audioHandle) {
      this.audioHandle.disconnect();
    }
  }

  changeVolume() {
    if (!this.muted && this.audioHandle) {
      this.audioHandle.changeVolume(1);
    }
  }

  initAudioBuffer() {
    this.audioIndex = 0;
    this.audioDestinationPosition = 0;
    this.downsampleInput = 0;
    this.bufferContainAmount =
      Math.max(
        (this.baseCPUCyclesPerIteration * AUDIO_BUFFER_SPAN_MIN) /
          this.audioResamplerFirstPassFactor,
        4096
      ) << 1;
    this.numSamplesTotal =
      (this.baseCPUCyclesPerIteration / this.audioResamplerFirstPassFactor) <<
      1;
    this.audioBuffer = new Float32Array(this.numSamplesTotal);
  }

  intializeWhiteNoise() {
    //Noise Sample Tables:
    var randomFactor = 1;
    //15-bit LSFR Cache Generation:
    this.LSFR15Table = new Int8Array(0x80000);
    var LSFR = 0x7fff; //Seed value has all its bits set.
    var LSFRShifted = 0x3fff;
    for (var index = 0; index < 0x8000; ++index) {
      //Normalize the last LSFR value for usage:
      randomFactor = 1 - (LSFR & 1); //Docs say it's the inverse.
      //Cache the different volume level results:
      this.LSFR15Table[0x08000 | index] = randomFactor;
      this.LSFR15Table[0x10000 | index] = randomFactor * 0x2;
      this.LSFR15Table[0x18000 | index] = randomFactor * 0x3;
      this.LSFR15Table[0x20000 | index] = randomFactor * 0x4;
      this.LSFR15Table[0x28000 | index] = randomFactor * 0x5;
      this.LSFR15Table[0x30000 | index] = randomFactor * 0x6;
      this.LSFR15Table[0x38000 | index] = randomFactor * 0x7;
      this.LSFR15Table[0x40000 | index] = randomFactor * 0x8;
      this.LSFR15Table[0x48000 | index] = randomFactor * 0x9;
      this.LSFR15Table[0x50000 | index] = randomFactor * 0xa;
      this.LSFR15Table[0x58000 | index] = randomFactor * 0xb;
      this.LSFR15Table[0x60000 | index] = randomFactor * 0xc;
      this.LSFR15Table[0x68000 | index] = randomFactor * 0xd;
      this.LSFR15Table[0x70000 | index] = randomFactor * 0xe;
      this.LSFR15Table[0x78000 | index] = randomFactor * 0xf;
      //Recompute the LSFR algorithm:
      LSFRShifted = LSFR >> 1;
      LSFR = LSFRShifted | (((LSFRShifted ^ LSFR) & 0x1) << 14);
    }
    //7-bit LSFR Cache Generation:
    this.LSFR7Table = new Int8Array(0x800);
    LSFR = 0x7f; //Seed value has all its bits set.
    for (index = 0; index < 0x80; ++index) {
      //Normalize the last LSFR value for usage:
      randomFactor = 1 - (LSFR & 1); //Docs say it's the inverse.
      //Cache the different volume level results:
      this.LSFR7Table[0x080 | index] = randomFactor;
      this.LSFR7Table[0x100 | index] = randomFactor * 0x2;
      this.LSFR7Table[0x180 | index] = randomFactor * 0x3;
      this.LSFR7Table[0x200 | index] = randomFactor * 0x4;
      this.LSFR7Table[0x280 | index] = randomFactor * 0x5;
      this.LSFR7Table[0x300 | index] = randomFactor * 0x6;
      this.LSFR7Table[0x380 | index] = randomFactor * 0x7;
      this.LSFR7Table[0x400 | index] = randomFactor * 0x8;
      this.LSFR7Table[0x480 | index] = randomFactor * 0x9;
      this.LSFR7Table[0x500 | index] = randomFactor * 0xa;
      this.LSFR7Table[0x580 | index] = randomFactor * 0xb;
      this.LSFR7Table[0x600 | index] = randomFactor * 0xc;
      this.LSFR7Table[0x680 | index] = randomFactor * 0xd;
      this.LSFR7Table[0x700 | index] = randomFactor * 0xe;
      this.LSFR7Table[0x780 | index] = randomFactor * 0xf;
      //Recompute the LSFR algorithm:
      LSFRShifted = LSFR >> 1;
      LSFR = LSFRShifted | (((LSFRShifted ^ LSFR) & 0x1) << 6);
    }
    //Set the default noise table:
    this.noiseSampleTable = this.LSFR15Table;
  }

  audioUnderrunAdjustment() {
    if (!this.muted) {
      var underrunAmount = this.audioHandle.remainingBuffer();
      if (typeof underrunAmount == "number") {
        underrunAmount = this.bufferContainAmount - Math.max(underrunAmount, 0);
        if (underrunAmount > 0) {
          this.recalculateIterationClockLimitForAudio(
            (underrunAmount >> 1) * this.audioResamplerFirstPassFactor
          );
        }
      }
    }
  }

  initializeAudioStartState() {
    this.channel1FrequencyTracker = 0x2000;
    this.channel1DutyTracker = 0;
    this.channel1CachedDuty = this.dutyLookup[2];
    this.channel1totalLength = 0;
    this.channel1envelopeVolume = 0;
    this.channel1envelopeType = false;
    this.channel1envelopeSweeps = 0;
    this.channel1envelopeSweepsLast = 0;
    this.channel1consecutive = true;
    this.channel1frequency = 0;
    this.channel1SweepFault = false;
    this.channel1ShadowFrequency = 0;
    this.channel1timeSweep = 1;
    this.channel1lastTimeSweep = 0;
    this.channel1Swept = false;
    this.channel1frequencySweepDivider = 0;
    this.channel1decreaseSweep = false;
    this.channel2FrequencyTracker = 0x2000;
    this.channel2DutyTracker = 0;
    this.channel2CachedDuty = this.dutyLookup[2];
    this.channel2totalLength = 0;
    this.channel2envelopeVolume = 0;
    this.channel2envelopeType = false;
    this.channel2envelopeSweeps = 0;
    this.channel2envelopeSweepsLast = 0;
    this.channel2consecutive = true;
    this.channel2frequency = 0;
    this.channel3canPlay = false;
    this.channel3totalLength = 0;
    this.channel3patternType = 4;
    this.channel3frequency = 0;
    this.channel3consecutive = true;
    this.channel3Counter = 0x800;
    this.channel4FrequencyPeriod = 8;
    this.channel4totalLength = 0;
    this.channel4envelopeVolume = 0;
    this.channel4currentVolume = 0;
    this.channel4envelopeType = false;
    this.channel4envelopeSweeps = 0;
    this.channel4envelopeSweepsLast = 0;
    this.channel4consecutive = true;
    this.channel4BitRange = 0x7fff;
    this.channel4VolumeShifter = 15;
    this.channel1FrequencyCounter = 0x2000;
    this.channel2FrequencyCounter = 0x2000;
    this.channel3Counter = 0x800;
    this.channel3FrequencyPeriod = 0x800;
    this.channel3lastSampleLookup = 0;
    this.channel4lastSampleLookup = 0;
    this.VinLeftChannelMasterVolume = 8;
    this.VinRightChannelMasterVolume = 8;
    this.mixerOutputCache = 0;
    this.sequencerClocks = 0x2000;
    this.sequencePosition = 0;
    this.channel4FrequencyPeriod = 8;
    this.channel4Counter = 8;
    this.cachedChannel3Sample = 0;
    this.cachedChannel4Sample = 0;
    this.channel1Enabled = false;
    this.channel2Enabled = false;
    this.channel3Enabled = false;
    this.channel4Enabled = false;
    this.channel1canPlay = false;
    this.channel2canPlay = false;
    this.channel4canPlay = false;
    this.audioClocksUntilNextEvent = 1;
    this.audioClocksUntilNextEventCounter = 1;
    this.channel1OutputLevelCache();
    this.channel2OutputLevelCache();
    this.channel3OutputLevelCache();
    this.channel4OutputLevelCache();
    this.noiseSampleTable = this.LSFR15Table;
  }

  outputAudio() {
    this.audioBuffer[this.audioDestinationPosition++] =
      (this.downsampleInput >>> 16) * this.downSampleInputDivider - 1;
    this.audioBuffer[this.audioDestinationPosition++] =
      (this.downsampleInput & 0xffff) * this.downSampleInputDivider - 1;
    if (this.audioDestinationPosition == this.numSamplesTotal) {
      this.audioHandle.writeAudioNoCallback(this.audioBuffer);
      this.audioDestinationPosition = 0;
    }
    this.downsampleInput = 0;
  }

  generateAudio(numSamples: number) {
    var multiplier = 0;
    if (this.soundMasterEnabled && !this.CPUStopped) {
      for (var clockUpTo = 0; numSamples > 0; ) {
        clockUpTo = Math.min(
          Math.min(this.audioClocksUntilNextEventCounter, this.sequencerClocks),
          numSamples
        );
        this.audioClocksUntilNextEventCounter -= clockUpTo;
        this.sequencerClocks -= clockUpTo;
        numSamples -= clockUpTo;
        while (clockUpTo > 0) {
          multiplier = Math.min(
            clockUpTo,
            this.audioResamplerFirstPassFactor - this.audioIndex
          );
          clockUpTo -= multiplier;
          this.audioIndex += multiplier;
          this.downsampleInput += this.mixerOutputCache * multiplier;
          if (this.audioIndex == this.audioResamplerFirstPassFactor) {
            this.audioIndex = 0;
            this.outputAudio();
          }
        }
        if (this.sequencerClocks == 0) {
          this.audioComputeSequencer();
          this.sequencerClocks = 0x2000;
        }
        if (this.audioClocksUntilNextEventCounter == 0) {
          this.computeAudioChannels();
        }
      }
    } else {
      //SILENT OUTPUT:
      while (numSamples > 0) {
        multiplier = Math.min(
          numSamples,
          this.audioResamplerFirstPassFactor - this.audioIndex
        );
        numSamples -= multiplier;
        this.audioIndex += multiplier;
        if (this.audioIndex == this.audioResamplerFirstPassFactor) {
          this.audioIndex = 0;
          this.outputAudio();
        }
      }
    }
  }

  generateAudioFake(numSamples: number) {
    if (this.soundMasterEnabled && !this.CPUStopped) {
      for (var clockUpTo = 0; numSamples > 0; ) {
        clockUpTo = Math.min(
          Math.min(this.audioClocksUntilNextEventCounter, this.sequencerClocks),
          numSamples
        );
        this.audioClocksUntilNextEventCounter -= clockUpTo;
        this.sequencerClocks -= clockUpTo;
        numSamples -= clockUpTo;
        if (this.sequencerClocks == 0) {
          this.audioComputeSequencer();
          this.sequencerClocks = 0x2000;
        }
        if (this.audioClocksUntilNextEventCounter == 0) {
          this.computeAudioChannels();
        }
      }
    }
  }

  audioJIT() {
    //Audio Sample Generation Timing:
    if (!this.muted) {
      this.generateAudio(this.audioTicks);
    } else {
      this.generateAudioFake(this.audioTicks);
    }
    this.audioTicks = 0;
  }

  audioComputeSequencer() {
    switch (this.sequencePosition++) {
      case 0:
        this.clockAudioLength();
        break;
      case 2:
        this.clockAudioLength();
        this.clockAudioSweep();
        break;
      case 4:
        this.clockAudioLength();
        break;
      case 6:
        this.clockAudioLength();
        this.clockAudioSweep();
        break;
      case 7:
        this.clockAudioEnvelope();
        this.sequencePosition = 0;
    }
  }

  clockAudioLength() {
    //Channel 1:
    if (this.channel1totalLength > 1) {
      --this.channel1totalLength;
    } else if (this.channel1totalLength == 1) {
      this.channel1totalLength = 0;
      this.channel1EnableCheck();
      this.memory[0xff26] &= 0xfe; //Channel #1 On Flag Off
    }
    //Channel 2:
    if (this.channel2totalLength > 1) {
      --this.channel2totalLength;
    } else if (this.channel2totalLength == 1) {
      this.channel2totalLength = 0;
      this.channel2EnableCheck();
      this.memory[0xff26] &= 0xfd; //Channel #2 On Flag Off
    }
    //Channel 3:
    if (this.channel3totalLength > 1) {
      --this.channel3totalLength;
    } else if (this.channel3totalLength == 1) {
      this.channel3totalLength = 0;
      this.channel3EnableCheck();
      this.memory[0xff26] &= 0xfb; //Channel #3 On Flag Off
    }
    //Channel 4:
    if (this.channel4totalLength > 1) {
      --this.channel4totalLength;
    } else if (this.channel4totalLength == 1) {
      this.channel4totalLength = 0;
      this.channel4EnableCheck();
      this.memory[0xff26] &= 0xf7; //Channel #4 On Flag Off
    }
  }

  clockAudioSweep() {
    //Channel 1:
    if (!this.channel1SweepFault && this.channel1timeSweep > 0) {
      if (--this.channel1timeSweep == 0) {
        this.runAudioSweep();
      }
    }
  }

  runAudioSweep() {
    //Channel 1:
    if (this.channel1lastTimeSweep > 0) {
      if (this.channel1frequencySweepDivider > 0) {
        this.channel1Swept = true;
        if (this.channel1decreaseSweep) {
          this.channel1ShadowFrequency -=
            this.channel1ShadowFrequency >> this.channel1frequencySweepDivider;
          this.channel1frequency = this.channel1ShadowFrequency & 0x7ff;
          this.channel1FrequencyTracker = (0x800 - this.channel1frequency) << 2;
        } else {
          this.channel1ShadowFrequency +=
            this.channel1ShadowFrequency >> this.channel1frequencySweepDivider;
          this.channel1frequency = this.channel1ShadowFrequency;
          if (this.channel1ShadowFrequency <= 0x7ff) {
            this.channel1FrequencyTracker =
              (0x800 - this.channel1frequency) << 2;
            //Run overflow check twice:
            if (
              this.channel1ShadowFrequency +
                (this.channel1ShadowFrequency >>
                  this.channel1frequencySweepDivider) >
              0x7ff
            ) {
              this.channel1SweepFault = true;
              this.channel1EnableCheck();
              this.memory[0xff26] &= 0xfe; //Channel #1 On Flag Off
            }
          } else {
            this.channel1frequency &= 0x7ff;
            this.channel1SweepFault = true;
            this.channel1EnableCheck();
            this.memory[0xff26] &= 0xfe; //Channel #1 On Flag Off
          }
        }
        this.channel1timeSweep = this.channel1lastTimeSweep;
      } else {
        //Channel has sweep disabled and timer becomes a length counter:
        this.channel1SweepFault = true;
        this.channel1EnableCheck();
      }
    }
  }

  channel1AudioSweepPerformDummy() {
    //Channel 1:
    if (this.channel1frequencySweepDivider > 0) {
      if (!this.channel1decreaseSweep) {
        var channel1ShadowFrequency =
          this.channel1ShadowFrequency +
          (this.channel1ShadowFrequency >> this.channel1frequencySweepDivider);
        if (channel1ShadowFrequency <= 0x7ff) {
          //Run overflow check twice:
          if (
            channel1ShadowFrequency +
              (channel1ShadowFrequency >> this.channel1frequencySweepDivider) >
            0x7ff
          ) {
            this.channel1SweepFault = true;
            this.channel1EnableCheck();
            this.memory[0xff26] &= 0xfe; //Channel #1 On Flag Off
          }
        } else {
          this.channel1SweepFault = true;
          this.channel1EnableCheck();
          this.memory[0xff26] &= 0xfe; //Channel #1 On Flag Off
        }
      }
    }
  }

  clockAudioEnvelope() {
    //Channel 1:
    if (this.channel1envelopeSweepsLast > -1) {
      if (this.channel1envelopeSweeps > 0) {
        --this.channel1envelopeSweeps;
      } else {
        if (!this.channel1envelopeType) {
          if (this.channel1envelopeVolume > 0) {
            --this.channel1envelopeVolume;
            this.channel1envelopeSweeps = this.channel1envelopeSweepsLast;
            this.channel1OutputLevelCache();
          } else {
            this.channel1envelopeSweepsLast = -1;
          }
        } else if (this.channel1envelopeVolume < 0xf) {
          ++this.channel1envelopeVolume;
          this.channel1envelopeSweeps = this.channel1envelopeSweepsLast;
          this.channel1OutputLevelCache();
        } else {
          this.channel1envelopeSweepsLast = -1;
        }
      }
    }
    //Channel 2:
    if (this.channel2envelopeSweepsLast > -1) {
      if (this.channel2envelopeSweeps > 0) {
        --this.channel2envelopeSweeps;
      } else {
        if (!this.channel2envelopeType) {
          if (this.channel2envelopeVolume > 0) {
            --this.channel2envelopeVolume;
            this.channel2envelopeSweeps = this.channel2envelopeSweepsLast;
            this.channel2OutputLevelCache();
          } else {
            this.channel2envelopeSweepsLast = -1;
          }
        } else if (this.channel2envelopeVolume < 0xf) {
          ++this.channel2envelopeVolume;
          this.channel2envelopeSweeps = this.channel2envelopeSweepsLast;
          this.channel2OutputLevelCache();
        } else {
          this.channel2envelopeSweepsLast = -1;
        }
      }
    }
    //Channel 4:
    if (this.channel4envelopeSweepsLast > -1) {
      if (this.channel4envelopeSweeps > 0) {
        --this.channel4envelopeSweeps;
      } else {
        if (!this.channel4envelopeType) {
          if (this.channel4envelopeVolume > 0) {
            this.channel4currentVolume =
              --this.channel4envelopeVolume << this.channel4VolumeShifter;
            this.channel4envelopeSweeps = this.channel4envelopeSweepsLast;
            this.channel4UpdateCache();
          } else {
            this.channel4envelopeSweepsLast = -1;
          }
        } else if (this.channel4envelopeVolume < 0xf) {
          this.channel4currentVolume =
            ++this.channel4envelopeVolume << this.channel4VolumeShifter;
          this.channel4envelopeSweeps = this.channel4envelopeSweepsLast;
          this.channel4UpdateCache();
        } else {
          this.channel4envelopeSweepsLast = -1;
        }
      }
    }
  }

  computeAudioChannels() {
    //Clock down the four audio channels to the next closest audio event:
    this.channel1FrequencyCounter -= this.audioClocksUntilNextEvent;
    this.channel2FrequencyCounter -= this.audioClocksUntilNextEvent;
    this.channel3Counter -= this.audioClocksUntilNextEvent;
    this.channel4Counter -= this.audioClocksUntilNextEvent;
    //Channel 1 counter:
    if (this.channel1FrequencyCounter == 0) {
      this.channel1FrequencyCounter = this.channel1FrequencyTracker;
      this.channel1DutyTracker = (this.channel1DutyTracker + 1) & 0x7;
      this.channel1OutputLevelTrimaryCache();
    }
    //Channel 2 counter:
    if (this.channel2FrequencyCounter == 0) {
      this.channel2FrequencyCounter = this.channel2FrequencyTracker;
      this.channel2DutyTracker = (this.channel2DutyTracker + 1) & 0x7;
      this.channel2OutputLevelTrimaryCache();
    }
    //Channel 3 counter:
    if (this.channel3Counter == 0) {
      if (this.channel3canPlay) {
        this.channel3lastSampleLookup =
          (this.channel3lastSampleLookup + 1) & 0x1f;
      }
      this.channel3Counter = this.channel3FrequencyPeriod;
      this.channel3UpdateCache();
    }
    //Channel 4 counter:
    if (this.channel4Counter == 0) {
      this.channel4lastSampleLookup =
        (this.channel4lastSampleLookup + 1) & this.channel4BitRange;
      this.channel4Counter = this.channel4FrequencyPeriod;
      this.channel4UpdateCache();
    }
    //Find the number of clocks to next closest counter event:
    this.audioClocksUntilNextEventCounter = this.audioClocksUntilNextEvent = Math.min(
      Math.min(
        Math.min(this.channel1FrequencyCounter, this.channel2FrequencyCounter),
        this.channel3Counter
      ),
      this.channel4Counter
    );
  }

  channel1EnableCheck() {
    this.channel1Enabled =
      (this.channel1consecutive || this.channel1totalLength > 0) &&
      !this.channel1SweepFault &&
      this.channel1canPlay;
    this.channel1OutputLevelSecondaryCache();
  }

  channel1VolumeEnableCheck() {
    this.channel1canPlay = this.memory[0xff12] > 7;
    this.channel1EnableCheck();
    this.channel1OutputLevelSecondaryCache();
  }

  channel1OutputLevelCache() {
    this.channel1currentSampleLeft = this.leftChannel1
      ? this.channel1envelopeVolume
      : 0;
    this.channel1currentSampleRight = this.rightChannel1
      ? this.channel1envelopeVolume
      : 0;
    this.channel1OutputLevelSecondaryCache();
  }

  channel1OutputLevelSecondaryCache() {
    if (this.channel1Enabled) {
      this.channel1currentSampleLeftSecondary = this.channel1currentSampleLeft;
      this.channel1currentSampleRightSecondary = this.channel1currentSampleRight;
    } else {
      this.channel1currentSampleLeftSecondary = 0;
      this.channel1currentSampleRightSecondary = 0;
    }
    this.channel1OutputLevelTrimaryCache();
  }

  channel1OutputLevelTrimaryCache() {
    if (this.channel1CachedDuty[this.channel1DutyTracker]) {
      this.channel1currentSampleLeftTrimary = this.channel1currentSampleLeftSecondary;
      this.channel1currentSampleRightTrimary = this.channel1currentSampleRightSecondary;
    } else {
      this.channel1currentSampleLeftTrimary = 0;
      this.channel1currentSampleRightTrimary = 0;
    }
    this.mixerOutputLevelCache();
  }

  channel2EnableCheck() {
    this.channel2Enabled =
      (this.channel2consecutive || this.channel2totalLength > 0) &&
      this.channel2canPlay;
    this.channel2OutputLevelSecondaryCache();
  }

  channel2VolumeEnableCheck() {
    this.channel2canPlay = this.memory[0xff17] > 7;
    this.channel2EnableCheck();
    this.channel2OutputLevelSecondaryCache();
  }

  channel2OutputLevelCache() {
    this.channel2currentSampleLeft = this.leftChannel2
      ? this.channel2envelopeVolume
      : 0;
    this.channel2currentSampleRight = this.rightChannel2
      ? this.channel2envelopeVolume
      : 0;
    this.channel2OutputLevelSecondaryCache();
  }

  channel2OutputLevelSecondaryCache() {
    if (this.channel2Enabled) {
      this.channel2currentSampleLeftSecondary = this.channel2currentSampleLeft;
      this.channel2currentSampleRightSecondary = this.channel2currentSampleRight;
    } else {
      this.channel2currentSampleLeftSecondary = 0;
      this.channel2currentSampleRightSecondary = 0;
    }
    this.channel2OutputLevelTrimaryCache();
  }

  channel2OutputLevelTrimaryCache() {
    if (this.channel2CachedDuty[this.channel2DutyTracker]) {
      this.channel2currentSampleLeftTrimary = this.channel2currentSampleLeftSecondary;
      this.channel2currentSampleRightTrimary = this.channel2currentSampleRightSecondary;
    } else {
      this.channel2currentSampleLeftTrimary = 0;
      this.channel2currentSampleRightTrimary = 0;
    }
    this.mixerOutputLevelCache();
  }

  channel3EnableCheck() {
    this.channel3Enabled =
      /*this.channel3canPlay && */ this.channel3consecutive ||
      this.channel3totalLength > 0;
    this.channel3OutputLevelSecondaryCache();
  }

  channel3OutputLevelCache() {
    this.channel3currentSampleLeft = this.leftChannel3
      ? this.cachedChannel3Sample
      : 0;
    this.channel3currentSampleRight = this.rightChannel3
      ? this.cachedChannel3Sample
      : 0;
    this.channel3OutputLevelSecondaryCache();
  }

  channel3OutputLevelSecondaryCache() {
    if (this.channel3Enabled) {
      this.channel3currentSampleLeftSecondary = this.channel3currentSampleLeft;
      this.channel3currentSampleRightSecondary = this.channel3currentSampleRight;
    } else {
      this.channel3currentSampleLeftSecondary = 0;
      this.channel3currentSampleRightSecondary = 0;
    }
    this.mixerOutputLevelCache();
  }

  channel4EnableCheck() {
    this.channel4Enabled =
      (this.channel4consecutive || this.channel4totalLength > 0) &&
      this.channel4canPlay;
    this.channel4OutputLevelSecondaryCache();
  }

  channel4VolumeEnableCheck() {
    this.channel4canPlay = this.memory[0xff21] > 7;
    this.channel4EnableCheck();
    this.channel4OutputLevelSecondaryCache();
  }

  channel4OutputLevelCache() {
    this.channel4currentSampleLeft = this.leftChannel4
      ? this.cachedChannel4Sample
      : 0;
    this.channel4currentSampleRight = this.rightChannel4
      ? this.cachedChannel4Sample
      : 0;
    this.channel4OutputLevelSecondaryCache();
  }

  channel4OutputLevelSecondaryCache() {
    if (this.channel4Enabled) {
      this.channel4currentSampleLeftSecondary = this.channel4currentSampleLeft;
      this.channel4currentSampleRightSecondary = this.channel4currentSampleRight;
    } else {
      this.channel4currentSampleLeftSecondary = 0;
      this.channel4currentSampleRightSecondary = 0;
    }
    this.mixerOutputLevelCache();
  }

  mixerOutputLevelCache() {
    this.mixerOutputCache =
      (((this.channel1currentSampleLeftTrimary +
        this.channel2currentSampleLeftTrimary +
        this.channel3currentSampleLeftSecondary +
        this.channel4currentSampleLeftSecondary) *
        this.VinLeftChannelMasterVolume) <<
        16) |
      ((this.channel1currentSampleRightTrimary +
        this.channel2currentSampleRightTrimary +
        this.channel3currentSampleRightSecondary +
        this.channel4currentSampleRightSecondary) *
        this.VinRightChannelMasterVolume);
  }

  channel3UpdateCache() {
    this.cachedChannel3Sample =
      this.channel3PCM[this.channel3lastSampleLookup] >>
      this.channel3patternType;
    this.channel3OutputLevelCache();
  }

  channel3WriteRAM(address: number, data: number) {
    if (this.channel3canPlay) {
      this.audioJIT();
      //address = this.channel3lastSampleLookup >> 1;
    }
    this.memory[0xff30 | address] = data;
    address <<= 1;
    this.channel3PCM[address] = data >> 4;
    this.channel3PCM[address | 1] = data & 0xf;
  }

  channel4UpdateCache() {
    this.cachedChannel4Sample = this.noiseSampleTable[
      this.channel4currentVolume | this.channel4lastSampleLookup
    ];
    this.channel4OutputLevelCache();
  }

  run(force: boolean) {
    //The preprocessing before the actual iteration loop:
    if (force || (this.stopEmulator & 2) == 0) {
      if (force || (this.stopEmulator & 1) == 1) {
        if (!this.CPUStopped) {
          this.stopEmulator = 0;
          this.audioUnderrunAdjustment();
          this.clockUpdate(); //RTC clocking.
          if (!this.halt) {
            this.executeIteration();
          } else {
            //Finish the HALT rundown execution.
            this.CPUTicks = 0;
            this.calculateHALTPeriod();
            if (this.halt) {
              this.updateCore();
              this.iterationEndRoutine();
            } else {
              this.executeIteration();
            }
          }
          //Request the graphics target to be updated:
          this.requestDraw();
        } else {
          this.audioUnderrunAdjustment();
          this.audioTicks += this.CPUCyclesTotal;
          this.audioJIT();
          this.stopEmulator |= 1; //End current loop.
        }
      } else {
        //We can only get here if there was an internal error, but the loop was restarted.
        cout("Iterator restarted a faulted core.", 2);
        pause();
      }
    }
  }

  executeIteration() {
    //Iterate the interpreter loop:
    var opcodeToExecute = 0;
    var timedTicks = 0;
    while (this.stopEmulator == 0) {
      //Interrupt Arming:
      switch (this.IRQEnableDelay) {
        case 1:
          this.IME = true;
          this.checkIRQMatching();
        case 2:
          --this.IRQEnableDelay;
      }
      //Is an IRQ set to fire?:
      if (this.IRQLineMatched > 0) {
        //IME is true and and interrupt was matched:
        this.launchIRQ();
      }
      //Fetch the current opcode:
      opcodeToExecute = this.memoryReader[this.programCounter](
        this,
        this.programCounter
      );
      //Increment the program counter to the next instruction:
      this.programCounter = (this.programCounter + 1) & 0xffff;
      //Check for the program counter quirk:
      if (this.skipPCIncrement) {
        this.programCounter = (this.programCounter - 1) & 0xffff;
        this.skipPCIncrement = false;
      }
      //Get how many CPU cycles the current instruction counts for:
      this.CPUTicks = this.TICKTable[opcodeToExecute];
      //Execute the current instruction:
      this.OPCODE[opcodeToExecute](this);
      //Update the state (Inlined updateCoreFull manually here):
      //Update the clocking for the LCD emulation:
      this.LCDTicks += this.CPUTicks >> this.doubleSpeedShifter; //LCD Timing
      this.LCDCONTROL[this.actualScanLine](this); //Scan Line and STAT Mode Control
      //Single-speed relative timing for A/V emulation:
      timedTicks = this.CPUTicks >> this.doubleSpeedShifter; //CPU clocking can be updated from the LCD handling.
      this.audioTicks += timedTicks; //Audio Timing
      this.emulatorTicks += timedTicks; //Emulator Timing
      //CPU Timers:
      this.DIVTicks += this.CPUTicks; //DIV Timing
      if (this.TIMAEnabled) {
        //TIMA Timing
        this.timerTicks += this.CPUTicks;
        while (this.timerTicks >= this.TACClocker) {
          this.timerTicks -= this.TACClocker;
          if (++this.memory[0xff05] == 0x100) {
            this.memory[0xff05] = this.memory[0xff06];
            this.interruptsRequested |= 0x4;
            this.checkIRQMatching();
          }
        }
      }
      if (this.serialTimer > 0) {
        //Serial Timing
        //IRQ Counter:
        this.serialTimer -= this.CPUTicks;
        if (this.serialTimer <= 0) {
          this.interruptsRequested |= 0x8;
          this.checkIRQMatching();
        }
        //Bit Shit Counter:
        this.serialShiftTimer -= this.CPUTicks;
        if (this.serialShiftTimer <= 0) {
          this.serialShiftTimer = this.serialShiftTimerAllocated;
          this.memory[0xff01] = ((this.memory[0xff01] << 1) & 0xfe) | 0x01; //We could shift in actual link data here if we were to implement such!!!
        }
      }
      //End of iteration routine:
      if (this.emulatorTicks >= this.CPUCyclesTotal) {
        this.iterationEndRoutine();
      }
    }
  }

  iterationEndRoutine() {
    if ((this.stopEmulator & 0x1) == 0) {
      this.audioJIT(); //Make sure we at least output once per iteration.
      //Update DIV Alignment (Integer overflow safety):
      this.memory[0xff04] = (this.memory[0xff04] + (this.DIVTicks >> 8)) & 0xff;
      this.DIVTicks &= 0xff;
      //Update emulator flags:
      this.stopEmulator |= 1; //End current loop.
      this.emulatorTicks -= this.CPUCyclesTotal;
      this.CPUCyclesTotalCurrent += this.CPUCyclesTotalRoundoff;
      this.recalculateIterationClockLimit();
    }
  }

  handleSTOP() {
    this.CPUStopped = true; //Stop CPU until joypad input changes.
    this.iterationEndRoutine();
    if (this.emulatorTicks < 0) {
      this.audioTicks -= this.emulatorTicks;
      this.audioJIT();
    }
  }

  recalculateIterationClockLimit() {
    var endModulus = this.CPUCyclesTotalCurrent % 4;
    this.CPUCyclesTotal =
      this.CPUCyclesTotalBase + this.CPUCyclesTotalCurrent - endModulus;
    this.CPUCyclesTotalCurrent = endModulus;
  }

  recalculateIterationClockLimitForAudio(audioClocking: number) {
    this.CPUCyclesTotal += Math.min(
      (audioClocking >> 2) << 2,
      this.CPUCyclesTotalBase << 1
    );
  }

  scanLineMode2() {
    //OAM Search Period
    if (this.STATTracker != 1) {
      if (this.mode2TriggerSTAT) {
        this.interruptsRequested |= 0x2;
        this.checkIRQMatching();
      }
      this.STATTracker = 1;
      this.modeSTAT = 2;
    }
  }

  scanLineMode3() {
    //Scan Line Drawing Period
    if (this.modeSTAT != 3) {
      if (this.STATTracker == 0 && this.mode2TriggerSTAT) {
        this.interruptsRequested |= 0x2;
        this.checkIRQMatching();
      }
      this.STATTracker = 1;
      this.modeSTAT = 3;
    }
  }

  scanLineMode0() {
    //Horizontal Blanking Period
    if (this.modeSTAT != 0) {
      if (this.STATTracker != 2) {
        if (this.STATTracker == 0) {
          if (this.mode2TriggerSTAT) {
            this.interruptsRequested |= 0x2;
            this.checkIRQMatching();
          }
          this.modeSTAT = 3;
        }
        this.incrementScanLineQueue();
        this.updateSpriteCount(this.actualScanLine);
        this.STATTracker = 2;
      }
      if (this.LCDTicks >= this.spriteCount) {
        if (this.hdmaRunning) {
          this.executeHDMA();
        }
        if (this.mode0TriggerSTAT) {
          this.interruptsRequested |= 0x2;
          this.checkIRQMatching();
        }
        this.STATTracker = 3;
        this.modeSTAT = 0;
      }
    }
  }

  clocksUntilLYCMatch() {
    if (this.memory[0xff45] != 0) {
      if (this.memory[0xff45] > this.actualScanLine) {
        return 456 * (this.memory[0xff45] - this.actualScanLine);
      }
      return 456 * (154 - this.actualScanLine + this.memory[0xff45]);
    }
    return (
      456 *
        (this.actualScanLine == 153 && this.memory[0xff44] == 0
          ? 154
          : 153 - this.actualScanLine) +
      8
    );
  }

  clocksUntilMode0() {
    switch (this.modeSTAT) {
      case 0:
        if (this.actualScanLine == 143) {
          this.updateSpriteCount(0);
          return this.spriteCount + 5016;
        }
        this.updateSpriteCount(this.actualScanLine + 1);
        return this.spriteCount + 456;
      case 2:
      case 3:
        this.updateSpriteCount(this.actualScanLine);
        return this.spriteCount;
      case 1:
        this.updateSpriteCount(0);
        return this.spriteCount + 456 * (154 - this.actualScanLine);
      default:
        return 0;
    }
  }

  updateSpriteCount(line: number) {
    this.spriteCount = 252;
    if (this.cGBC && this.gfxSpriteShow) {
      //Is the window enabled and are we in CGB mode?
      var lineAdjusted = line + 0x10;
      var yoffset = 0;
      var yCap = this.gfxSpriteNormalHeight ? 0x8 : 0x10;
      for (
        var OAMAddress = 0xfe00;
        OAMAddress < 0xfea0 && this.spriteCount < 312;
        OAMAddress += 4
      ) {
        yoffset = lineAdjusted - this.memory[OAMAddress];
        if (yoffset > -1 && yoffset < yCap) {
          this.spriteCount += 6;
        }
      }
    }
  }

  matchLYC() {
    //LYC Register Compare
    if (this.memory[0xff44] == this.memory[0xff45]) {
      this.memory[0xff41] |= 0x04;
      if (this.LYCMatchTriggerSTAT) {
        this.interruptsRequested |= 0x2;
        this.checkIRQMatching();
      }
    } else {
      this.memory[0xff41] &= 0x7b;
    }
  }

  updateCore() {
    //Update the clocking for the LCD emulation:
    this.LCDTicks += this.CPUTicks >> this.doubleSpeedShifter; //LCD Timing
    this.LCDCONTROL[this.actualScanLine](this); //Scan Line and STAT Mode Control
    //Single-speed relative timing for A/V emulation:
    var timedTicks = this.CPUTicks >> this.doubleSpeedShifter; //CPU clocking can be updated from the LCD handling.
    this.audioTicks += timedTicks; //Audio Timing
    this.emulatorTicks += timedTicks; //Emulator Timing
    //CPU Timers:
    this.DIVTicks += this.CPUTicks; //DIV Timing
    if (this.TIMAEnabled) {
      //TIMA Timing
      this.timerTicks += this.CPUTicks;
      while (this.timerTicks >= this.TACClocker) {
        this.timerTicks -= this.TACClocker;
        if (++this.memory[0xff05] == 0x100) {
          this.memory[0xff05] = this.memory[0xff06];
          this.interruptsRequested |= 0x4;
          this.checkIRQMatching();
        }
      }
    }
    if (this.serialTimer > 0) {
      //Serial Timing
      //IRQ Counter:
      this.serialTimer -= this.CPUTicks;
      if (this.serialTimer <= 0) {
        this.interruptsRequested |= 0x8;
        this.checkIRQMatching();
      }
      //Bit Shit Counter:
      this.serialShiftTimer -= this.CPUTicks;
      if (this.serialShiftTimer <= 0) {
        this.serialShiftTimer = this.serialShiftTimerAllocated;
        this.memory[0xff01] = ((this.memory[0xff01] << 1) & 0xfe) | 0x01; //We could shift in actual link data here if we were to implement such!!!
      }
    }
  }

  updateCoreFull() {
    //Update the state machine:
    this.updateCore();
    //End of iteration routine:
    if (this.emulatorTicks >= this.CPUCyclesTotal) {
      this.iterationEndRoutine();
    }
  }

  initializeLCDController() {
    //Display on hanlding:
    var line = 0;
    while (line < 154) {
      if (line < 143) {
        //We're on a normal scan line:
        this.LINECONTROL[line] = function(parentObj: GameBoyCore) {
          if (parentObj.LCDTicks < 80) {
            parentObj.scanLineMode2();
          } else if (parentObj.LCDTicks < 252) {
            parentObj.scanLineMode3();
          } else if (parentObj.LCDTicks < 456) {
            parentObj.scanLineMode0();
          } else {
            //We're on a new scan line:
            parentObj.LCDTicks -= 456;
            if (parentObj.STATTracker != 3) {
              //Make sure the mode 0 handler was run at least once per scan line:
              if (parentObj.STATTracker != 2) {
                if (parentObj.STATTracker == 0 && parentObj.mode2TriggerSTAT) {
                  parentObj.interruptsRequested |= 0x2;
                }
                parentObj.incrementScanLineQueue();
              }
              if (parentObj.hdmaRunning) {
                parentObj.executeHDMA();
              }
              if (parentObj.mode0TriggerSTAT) {
                parentObj.interruptsRequested |= 0x2;
              }
            }
            //Update the scanline registers and assert the LYC counter:
            parentObj.actualScanLine = ++parentObj.memory[0xff44];
            //Perform a LYC counter assert:
            if (parentObj.actualScanLine == parentObj.memory[0xff45]) {
              parentObj.memory[0xff41] |= 0x04;
              if (parentObj.LYCMatchTriggerSTAT) {
                parentObj.interruptsRequested |= 0x2;
              }
            } else {
              parentObj.memory[0xff41] &= 0x7b;
            }
            parentObj.checkIRQMatching();
            //Reset our mode contingency variables:
            parentObj.STATTracker = 0;
            parentObj.modeSTAT = 2;
            parentObj.LINECONTROL[parentObj.actualScanLine](parentObj); //Scan Line and STAT Mode Control.
          }
        };
      } else if (line == 143) {
        //We're on the last visible scan line of the LCD screen:
        this.LINECONTROL[143] = function(parentObj: GameBoyCore) {
          if (parentObj.LCDTicks < 80) {
            parentObj.scanLineMode2();
          } else if (parentObj.LCDTicks < 252) {
            parentObj.scanLineMode3();
          } else if (parentObj.LCDTicks < 456) {
            parentObj.scanLineMode0();
          } else {
            //Starting V-Blank:
            //Just finished the last visible scan line:
            parentObj.LCDTicks -= 456;
            if (parentObj.STATTracker != 3) {
              //Make sure the mode 0 handler was run at least once per scan line:
              if (parentObj.STATTracker != 2) {
                if (parentObj.STATTracker == 0 && parentObj.mode2TriggerSTAT) {
                  parentObj.interruptsRequested |= 0x2;
                }
                parentObj.incrementScanLineQueue();
              }
              if (parentObj.hdmaRunning) {
                parentObj.executeHDMA();
              }
              if (parentObj.mode0TriggerSTAT) {
                parentObj.interruptsRequested |= 0x2;
              }
            }
            //Update the scanline registers and assert the LYC counter:
            parentObj.actualScanLine = parentObj.memory[0xff44] = 144;
            //Perform a LYC counter assert:
            if (parentObj.memory[0xff45] == 144) {
              parentObj.memory[0xff41] |= 0x04;
              if (parentObj.LYCMatchTriggerSTAT) {
                parentObj.interruptsRequested |= 0x2;
              }
            } else {
              parentObj.memory[0xff41] &= 0x7b;
            }
            //Reset our mode contingency variables:
            parentObj.STATTracker = 0;
            //Update our state for v-blank:
            parentObj.modeSTAT = 1;
            parentObj.interruptsRequested |= parentObj.mode1TriggerSTAT
              ? 0x3
              : 0x1;
            parentObj.checkIRQMatching();
            //Attempt to blit out to our canvas:
            if (parentObj.drewBlank == 0) {
              //Ensure JIT framing alignment:
              if (
                parentObj.totalLinesPassed < 144 ||
                (parentObj.totalLinesPassed == 144 &&
                  parentObj.midScanlineOffset > -1)
              ) {
                //Make sure our gfx are up-to-date:
                parentObj.graphicsJITVBlank();
                //Draw the frame:
                parentObj.prepareFrame();
              }
            } else {
              //LCD off takes at least 2 frames:
              --parentObj.drewBlank;
            }
            parentObj.LINECONTROL[144](parentObj); //Scan Line and STAT Mode Control.
          }
        };
      } else if (line < 153) {
        //In VBlank
        this.LINECONTROL[line] = function(parentObj: GameBoyCore) {
          if (parentObj.LCDTicks >= 456) {
            //We're on a new scan line:
            parentObj.LCDTicks -= 456;
            parentObj.actualScanLine = ++parentObj.memory[0xff44];
            //Perform a LYC counter assert:
            if (parentObj.actualScanLine == parentObj.memory[0xff45]) {
              parentObj.memory[0xff41] |= 0x04;
              if (parentObj.LYCMatchTriggerSTAT) {
                parentObj.interruptsRequested |= 0x2;
                parentObj.checkIRQMatching();
              }
            } else {
              parentObj.memory[0xff41] &= 0x7b;
            }
            parentObj.LINECONTROL[parentObj.actualScanLine](parentObj); //Scan Line and STAT Mode Control.
          }
        };
      } else {
        //VBlank Ending (We're on the last actual scan line)
        this.LINECONTROL[153] = function(parentObj: GameBoyCore) {
          if (parentObj.LCDTicks >= 8) {
            if (parentObj.STATTracker != 4 && parentObj.memory[0xff44] == 153) {
              parentObj.memory[0xff44] = 0; //LY register resets to 0 early.
              //Perform a LYC counter assert:
              if (parentObj.memory[0xff45] == 0) {
                parentObj.memory[0xff41] |= 0x04;
                if (parentObj.LYCMatchTriggerSTAT) {
                  parentObj.interruptsRequested |= 0x2;
                  parentObj.checkIRQMatching();
                }
              } else {
                parentObj.memory[0xff41] &= 0x7b;
              }
              parentObj.STATTracker = 4;
            }
            if (parentObj.LCDTicks >= 456) {
              //We reset back to the beginning:
              parentObj.LCDTicks -= 456;
              parentObj.STATTracker = parentObj.actualScanLine = 0;
              parentObj.LINECONTROL[0](parentObj); //Scan Line and STAT Mode Control.
            }
          }
        };
      }
      ++line;
    }
  }

  DisplayShowOff() {
    if (this.drewBlank == 0) {
      //Output a blank screen to the output framebuffer:
      this.clearFrameBuffer();
      this.drewFrame = true;
    }
    this.drewBlank = 2;
  }

  executeHDMA() {
    this.DMAWrite(1);
    if (this.halt) {
      if (
        this.LCDTicks - this.spriteCount <
        ((4 >> this.doubleSpeedShifter) | 0x20)
      ) {
        //HALT clocking correction:
        this.CPUTicks =
          4 + ((0x20 + this.spriteCount) << this.doubleSpeedShifter);
        this.LCDTicks =
          this.spriteCount + ((4 >> this.doubleSpeedShifter) | 0x20);
      }
    } else {
      this.LCDTicks += (4 >> this.doubleSpeedShifter) | 0x20; //LCD Timing Update For HDMA.
    }
    if (this.memory[0xff55] == 0) {
      this.hdmaRunning = false;
      this.memory[0xff55] = 0xff; //Transfer completed ("Hidden last step," since some ROMs don't imply this, but most do).
    } else {
      --this.memory[0xff55];
    }
  }

  clockUpdate(manualTime?: {
    seconds: number;
    minutes: number;
    hours: number;
    days: number;
  }) {
    if (!this.cTIMER) {
      return;
    }

    if (manualTime) {
      const { seconds, minutes, hours, days } = manualTime;

      this.RTCSeconds = seconds;
      this.RTCMinutes = minutes;
      this.RTCHours = hours;
      this.RTCDays = days;

      return;
    }

    var newTime = Date.now();
    var timeElapsed = newTime - this.lastIteration; //Get the numnber of milliseconds since this last executed.
    this.lastIteration = newTime;
    //Update the MBC3 RTC:
    this.RTCSeconds += timeElapsed / 1000;
    while (this.RTCSeconds >= 60) {
      //System can stutter, so the seconds difference can get large, thus the "while".
      this.RTCSeconds -= 60;
      ++this.RTCMinutes;
      if (this.RTCMinutes >= 60) {
        this.RTCMinutes -= 60;
        ++this.RTCHours;
        if (this.RTCHours >= 24) {
          this.RTCHours -= 24;
          ++this.RTCDays;
          if (this.RTCDays >= 512) {
            this.RTCDays -= 512;
            this.RTCDayOverFlow = true;
          }
        }
      }
    }
  }

  prepareFrame() {
    //Copy the internal frame buffer to the output buffer:
    this.swizzleFrameBuffer();
    this.drewFrame = true;
  }

  requestDraw() {
    if (this.drewFrame) {
      this.dispatchDraw();
    }
  }

  dispatchDraw() {
    if (this.RGBCount > 0) {
      //We actually updated the graphics internally, so copy out:
      this.processDraw(this.swizzledFrame);
    }
  }

  processDraw(frameBuffer: Uint8Array) {
    var canvasRGBALength = this.RGBCount;
    var canvasData = this.canvasBuffer;
    var bufferIndex = 0;
    for (var canvasIndex = 0; canvasIndex < canvasRGBALength; ++canvasIndex) {
      canvasData[canvasIndex++] = frameBuffer[bufferIndex++];
      canvasData[canvasIndex++] = frameBuffer[bufferIndex++];
      canvasData[canvasIndex++] = frameBuffer[bufferIndex++];
    }
    this.executeDraw();
    this.drewFrame = false;
  }

  swizzleFrameBuffer() {
    //Convert our dirty 24-bit (24-bit, with internal render flags above it) framebuffer to an 8-bit buffer with separate indices for the RGB channels:
    var frameBuffer = this.frameBuffer;
    var swizzledFrame = this.swizzledFrame;
    var bufferIndex = 0;
    for (var canvasIndex = 0; canvasIndex < 69120; ) {
      swizzledFrame[canvasIndex++] = (frameBuffer[bufferIndex] >> 16) & 0xff; //Red
      swizzledFrame[canvasIndex++] = (frameBuffer[bufferIndex] >> 8) & 0xff; //Green
      swizzledFrame[canvasIndex++] = frameBuffer[bufferIndex++] & 0xff; //Blue
    }
  }

  clearFrameBuffer() {
    var bufferIndex = 0;
    var frameBuffer = this.swizzledFrame;
    if (this.cGBC || this.colorizedGBPalettes) {
      while (bufferIndex < 69120) {
        frameBuffer[bufferIndex++] = 248;
      }
    } else {
      while (bufferIndex < 69120) {
        frameBuffer[bufferIndex++] = 239;
        frameBuffer[bufferIndex++] = 255;
        frameBuffer[bufferIndex++] = 222;
      }
    }
  }

  renderScanLine(scanlineToRender: number) {
    this.pixelStart = scanlineToRender * 160;
    if (this.bgEnabled) {
      this.pixelEnd = 160;
      this.BGLayerRender(scanlineToRender);
      this.WindowLayerRender(scanlineToRender);
    } else {
      var pixelLine = (scanlineToRender + 1) * 160;
      var defaultColor =
        this.cGBC || this.colorizedGBPalettes ? 0xf8f8f8 : 0xefffde;
      for (
        var pixelPosition = scanlineToRender * 160 + this.currentX;
        pixelPosition < pixelLine;
        pixelPosition++
      ) {
        this.frameBuffer[pixelPosition] = defaultColor;
      }
    }
    this.SpriteLayerRender(scanlineToRender);
    this.currentX = 0;
    this.midScanlineOffset = -1;
  }

  renderMidScanLine() {
    if (this.actualScanLine < 144 && this.modeSTAT == 3) {
      //TODO: Get this accurate:
      if (this.midScanlineOffset == -1) {
        this.midScanlineOffset = this.backgroundX & 0x7;
      }
      if (this.LCDTicks >= 82) {
        this.pixelEnd = this.LCDTicks - 74;
        this.pixelEnd = Math.min(
          this.pixelEnd - this.midScanlineOffset - (this.pixelEnd % 0x8),
          160
        );
        if (this.bgEnabled) {
          this.pixelStart = this.lastUnrenderedLine * 160;
          this.BGLayerRender(this.lastUnrenderedLine);
          this.WindowLayerRender(this.lastUnrenderedLine);
          //TODO: Do midscanline JIT for sprites...
        } else {
          var pixelLine = this.lastUnrenderedLine * 160 + this.pixelEnd;
          var defaultColor =
            this.cGBC || this.colorizedGBPalettes ? 0xf8f8f8 : 0xefffde;
          for (
            var pixelPosition = this.lastUnrenderedLine * 160 + this.currentX;
            pixelPosition < pixelLine;
            pixelPosition++
          ) {
            this.frameBuffer[pixelPosition] = defaultColor;
          }
        }
        this.currentX = this.pixelEnd;
      }
    }
  }

  initializeModeSpecificArrays() {
    this.LCDCONTROL = this.LCDisOn ? this.LINECONTROL : this.DISPLAYOFFCONTROL;
    if (this.cGBC) {
      this.gbcOBJRawPalette = new Uint8Array(0x40);
      this.gbcBGRawPalette = new Uint8Array(0x40);
      this.gbcOBJPalette = new Int32Array(0x20).fill(0x1000000);
      this.gbcBGPalette = new Int32Array(0x40);
      this.BGCHRBank2 = new Uint8Array(0x800);
      this.BGCHRCurrentBank =
        this.currVRAMBank > 0 ? this.BGCHRBank2 : this.BGCHRBank1;
      this.tileCache = this.generateCacheArray(0xf80);
    } else {
      this.gbOBJPalette = new Int32Array(8);
      this.gbBGPalette = new Int32Array(4);
      this.BGPalette = this.gbBGPalette;
      this.OBJPalette = this.gbOBJPalette;
      this.tileCache = this.generateCacheArray(0x700);
      this.sortBuffer = new Uint8Array(0x100);
      this.OAMAddressCache = new Int32Array(10);
    }
    this.renderPathBuild();
  }

  GBCtoGBModeAdjust() {
    cout("Stepping down from GBC mode.", 0);
    this.VRAM = this.GBCMemory = this.BGCHRCurrentBank = this.BGCHRBank2 = new Uint8Array(
      0
    );
    this.tileCache.length = 0x700;
    this.gbBGColorizedPalette = new Int32Array(4);
    this.gbOBJColorizedPalette = new Int32Array(8);
    this.cachedBGPaletteConversion = new Int32Array(4);
    this.cachedOBJPaletteConversion = new Int32Array(8);
    this.BGPalette = this.gbBGColorizedPalette;
    this.OBJPalette = this.gbOBJColorizedPalette;
    this.gbOBJPalette = this.gbBGPalette = new Int32Array(0);
    this.getGBCColor();
    this.sortBuffer = new Uint8Array(0x100);
    this.OAMAddressCache = new Int32Array(10);
    this.renderPathBuild();
    this.memoryReadJumpCompile();
    this.memoryWriteJumpCompile();
  }

  renderPathBuild() {
    if (!this.cGBC) {
      this.BGLayerRender = this.BGGBLayerRender;
      this.WindowLayerRender = this.WindowGBLayerRender;
      this.SpriteLayerRender = this.SpriteGBLayerRender;
    } else {
      this.priorityFlaggingPathRebuild();
      this.SpriteLayerRender = this.SpriteGBCLayerRender;
    }
  }

  priorityFlaggingPathRebuild() {
    if (this.BGPriorityEnabled) {
      this.BGLayerRender = this.BGGBCLayerRender;
      this.WindowLayerRender = this.WindowGBCLayerRender;
    } else {
      this.BGLayerRender = this.BGGBCLayerRenderNoPriorityFlagging;
      this.WindowLayerRender = this.WindowGBCLayerRenderNoPriorityFlagging;
    }
  }

  initializeReferencesFromSaveState() {
    this.LCDCONTROL = this.LCDisOn ? this.LINECONTROL : this.DISPLAYOFFCONTROL;
    var tileIndex = 0;
    if (!this.cGBC) {
      if (this.colorizedGBPalettes) {
        this.BGPalette = this.gbBGColorizedPalette;
        this.OBJPalette = this.gbOBJColorizedPalette;
        this.updateGBBGPalette = this.updateGBColorizedBGPalette;
        this.updateGBOBJPalette = this.updateGBColorizedOBJPalette;
      } else {
        this.BGPalette = this.gbBGPalette;
        this.OBJPalette = this.gbOBJPalette;
      }
      this.tileCache = this.generateCacheArray(0x700);
      for (tileIndex = 0x8000; tileIndex < 0x9000; tileIndex += 2) {
        this.generateGBOAMTileLine(tileIndex);
      }
      for (tileIndex = 0x9000; tileIndex < 0x9800; tileIndex += 2) {
        this.generateGBTileLine(tileIndex);
      }
      this.sortBuffer = new Uint8Array(0x100);
      this.OAMAddressCache = new Int32Array(10);
    } else {
      this.BGCHRCurrentBank =
        this.currVRAMBank > 0 ? this.BGCHRBank2 : this.BGCHRBank1;
      this.tileCache = this.generateCacheArray(0xf80);
      for (; tileIndex < 0x1800; tileIndex += 0x10) {
        this.generateGBCTileBank1(tileIndex);
        this.generateGBCTileBank2(tileIndex);
      }
    }
    this.renderPathBuild();
  }

  RGBTint(value: number) {
    //Adjustment for the GBC's tinting (According to Gambatte):
    var r = value & 0x1f;
    var g = (value >> 5) & 0x1f;
    var b = (value >> 10) & 0x1f;
    return (
      (((r * 13 + g * 2 + b) >> 1) << 16) |
      ((g * 3 + b) << 9) |
      ((r * 3 + g * 2 + b * 11) >> 1)
    );
  }

  getGBCColor() {
    //GBC Colorization of DMG ROMs:
    //BG
    for (var counter = 0; counter < 4; counter++) {
      var adjustedIndex = counter << 1;
      //BG
      this.cachedBGPaletteConversion[counter] = this.RGBTint(
        (this.gbcBGRawPalette[adjustedIndex | 1] << 8) |
          this.gbcBGRawPalette[adjustedIndex]
      );
      //OBJ 1
      this.cachedOBJPaletteConversion[counter] = this.RGBTint(
        (this.gbcOBJRawPalette[adjustedIndex | 1] << 8) |
          this.gbcOBJRawPalette[adjustedIndex]
      );
    }
    //OBJ 2
    for (counter = 4; counter < 8; counter++) {
      adjustedIndex = counter << 1;
      this.cachedOBJPaletteConversion[counter] = this.RGBTint(
        (this.gbcOBJRawPalette[adjustedIndex | 1] << 8) |
          this.gbcOBJRawPalette[adjustedIndex]
      );
    }
    //Update the palette entries:
    this.updateGBBGPalette = this.updateGBColorizedBGPalette;
    this.updateGBOBJPalette = this.updateGBColorizedOBJPalette;
    this.updateGBBGPalette(this.memory[0xff47]);
    this.updateGBOBJPalette(0, this.memory[0xff48]);
    this.updateGBOBJPalette(1, this.memory[0xff49]);
    this.colorizedGBPalettes = true;
  }

  updateGBRegularBGPalette(data: number) {
    this.gbBGPalette[0] = this.colors[data & 0x03] | 0x2000000;
    this.gbBGPalette[1] = this.colors[(data >> 2) & 0x03];
    this.gbBGPalette[2] = this.colors[(data >> 4) & 0x03];
    this.gbBGPalette[3] = this.colors[data >> 6];
  }

  updateGBColorizedBGPalette(data: number) {
    //GB colorization:
    this.gbBGColorizedPalette[0] =
      this.cachedBGPaletteConversion[data & 0x03] | 0x2000000;
    this.gbBGColorizedPalette[1] = this.cachedBGPaletteConversion[
      (data >> 2) & 0x03
    ];
    this.gbBGColorizedPalette[2] = this.cachedBGPaletteConversion[
      (data >> 4) & 0x03
    ];
    this.gbBGColorizedPalette[3] = this.cachedBGPaletteConversion[data >> 6];
  }

  updateGBRegularOBJPalette(index: number, data: number) {
    this.gbOBJPalette[index | 1] = this.colors[(data >> 2) & 0x03];
    this.gbOBJPalette[index | 2] = this.colors[(data >> 4) & 0x03];
    this.gbOBJPalette[index | 3] = this.colors[data >> 6];
  }

  updateGBColorizedOBJPalette(index: number, data: number) {
    //GB colorization:
    this.gbOBJColorizedPalette[index | 1] = this.cachedOBJPaletteConversion[
      index | ((data >> 2) & 0x03)
    ];
    this.gbOBJColorizedPalette[index | 2] = this.cachedOBJPaletteConversion[
      index | ((data >> 4) & 0x03)
    ];
    this.gbOBJColorizedPalette[index | 3] = this.cachedOBJPaletteConversion[
      index | (data >> 6)
    ];
  }

  updateGBCBGPalette(index: number, data: number) {
    if (this.gbcBGRawPalette[index] != data) {
      this.midScanLineJIT();
      //Update the color palette for BG tiles since it changed:
      this.gbcBGRawPalette[index] = data;
      if ((index & 0x06) == 0) {
        //Palette 0 (Special tile Priority stuff)
        data =
          0x2000000 |
          this.RGBTint(
            (this.gbcBGRawPalette[index | 1] << 8) |
              this.gbcBGRawPalette[index & 0x3e]
          );
        index >>= 1;
        this.gbcBGPalette[index] = data;
        this.gbcBGPalette[0x20 | index] = 0x1000000 | data;
      } else {
        //Regular Palettes (No special crap)
        data = this.RGBTint(
          (this.gbcBGRawPalette[index | 1] << 8) |
            this.gbcBGRawPalette[index & 0x3e]
        );
        index >>= 1;
        this.gbcBGPalette[index] = data;
        this.gbcBGPalette[0x20 | index] = 0x1000000 | data;
      }
    }
  }

  updateGBCOBJPalette(index: number, data: number) {
    if (this.gbcOBJRawPalette[index] != data) {
      //Update the color palette for OBJ tiles since it changed:
      this.gbcOBJRawPalette[index] = data;
      if ((index & 0x06) > 0) {
        //Regular Palettes (No special crap)
        this.midScanLineJIT();
        this.gbcOBJPalette[index >> 1] =
          0x1000000 |
          this.RGBTint(
            (this.gbcOBJRawPalette[index | 1] << 8) |
              this.gbcOBJRawPalette[index & 0x3e]
          );
      }
    }
  }

  BGGBLayerRender(scanlineToRender: number) {
    var scrollYAdjusted = (this.backgroundY + scanlineToRender) & 0xff; //The line of the BG we're at.
    var tileYLine = (scrollYAdjusted & 7) << 3;
    var tileYDown =
      this.gfxBackgroundCHRBankPosition | ((scrollYAdjusted & 0xf8) << 2); //The row of cached tiles we're fetching from.
    var scrollXAdjusted = (this.backgroundX + this.currentX) & 0xff; //The scroll amount of the BG.
    var pixelPosition = this.pixelStart + this.currentX; //Current pixel we're working on.
    var pixelPositionEnd =
      this.pixelStart +
      (this.gfxWindowDisplay && scanlineToRender - this.windowY >= 0
        ? Math.min(Math.max(this.windowX, 0) + this.currentX, this.pixelEnd)
        : this.pixelEnd); //Make sure we do at most 160 pixels a scanline.
    var tileNumber = tileYDown + (scrollXAdjusted >> 3);
    var chrCode = this.BGCHRBank1[tileNumber];
    if (chrCode < this.gfxBackgroundBankOffset) {
      chrCode |= 0x100;
    }
    var tile = this.tileCache[chrCode];
    for (
      var texel = scrollXAdjusted & 0x7;
      texel < 8 && pixelPosition < pixelPositionEnd && scrollXAdjusted < 0x100;
      ++scrollXAdjusted
    ) {
      this.frameBuffer[pixelPosition++] = this.BGPalette[
        tile[tileYLine | texel++]
      ];
    }
    var scrollXAdjustedAligned =
      Math.min(pixelPositionEnd - pixelPosition, 0x100 - scrollXAdjusted) >> 3;
    scrollXAdjusted += scrollXAdjustedAligned << 3;
    scrollXAdjustedAligned += tileNumber;
    while (tileNumber < scrollXAdjustedAligned) {
      chrCode = this.BGCHRBank1[++tileNumber];
      if (chrCode < this.gfxBackgroundBankOffset) {
        chrCode |= 0x100;
      }
      tile = this.tileCache[chrCode];
      texel = tileYLine;
      this.frameBuffer[pixelPosition++] = this.BGPalette[tile[texel++]];
      this.frameBuffer[pixelPosition++] = this.BGPalette[tile[texel++]];
      this.frameBuffer[pixelPosition++] = this.BGPalette[tile[texel++]];
      this.frameBuffer[pixelPosition++] = this.BGPalette[tile[texel++]];
      this.frameBuffer[pixelPosition++] = this.BGPalette[tile[texel++]];
      this.frameBuffer[pixelPosition++] = this.BGPalette[tile[texel++]];
      this.frameBuffer[pixelPosition++] = this.BGPalette[tile[texel++]];
      this.frameBuffer[pixelPosition++] = this.BGPalette[tile[texel]];
    }
    if (pixelPosition < pixelPositionEnd) {
      if (scrollXAdjusted < 0x100) {
        chrCode = this.BGCHRBank1[++tileNumber];
        if (chrCode < this.gfxBackgroundBankOffset) {
          chrCode |= 0x100;
        }
        tile = this.tileCache[chrCode];
        for (
          texel = tileYLine - 1;
          pixelPosition < pixelPositionEnd && scrollXAdjusted < 0x100;
          ++scrollXAdjusted
        ) {
          this.frameBuffer[pixelPosition++] = this.BGPalette[tile[++texel]];
        }
      }
      scrollXAdjustedAligned =
        ((pixelPositionEnd - pixelPosition) >> 3) + tileYDown;
      while (tileYDown < scrollXAdjustedAligned) {
        chrCode = this.BGCHRBank1[tileYDown++];
        if (chrCode < this.gfxBackgroundBankOffset) {
          chrCode |= 0x100;
        }
        tile = this.tileCache[chrCode];
        texel = tileYLine;
        this.frameBuffer[pixelPosition++] = this.BGPalette[tile[texel++]];
        this.frameBuffer[pixelPosition++] = this.BGPalette[tile[texel++]];
        this.frameBuffer[pixelPosition++] = this.BGPalette[tile[texel++]];
        this.frameBuffer[pixelPosition++] = this.BGPalette[tile[texel++]];
        this.frameBuffer[pixelPosition++] = this.BGPalette[tile[texel++]];
        this.frameBuffer[pixelPosition++] = this.BGPalette[tile[texel++]];
        this.frameBuffer[pixelPosition++] = this.BGPalette[tile[texel++]];
        this.frameBuffer[pixelPosition++] = this.BGPalette[tile[texel]];
      }
      if (pixelPosition < pixelPositionEnd) {
        chrCode = this.BGCHRBank1[tileYDown];
        if (chrCode < this.gfxBackgroundBankOffset) {
          chrCode |= 0x100;
        }
        tile = this.tileCache[chrCode];
        switch (pixelPositionEnd - pixelPosition) {
          case 7:
            this.frameBuffer[pixelPosition + 6] = this.BGPalette[
              tile[tileYLine | 6]
            ];
          case 6:
            this.frameBuffer[pixelPosition + 5] = this.BGPalette[
              tile[tileYLine | 5]
            ];
          case 5:
            this.frameBuffer[pixelPosition + 4] = this.BGPalette[
              tile[tileYLine | 4]
            ];
          case 4:
            this.frameBuffer[pixelPosition + 3] = this.BGPalette[
              tile[tileYLine | 3]
            ];
          case 3:
            this.frameBuffer[pixelPosition + 2] = this.BGPalette[
              tile[tileYLine | 2]
            ];
          case 2:
            this.frameBuffer[pixelPosition + 1] = this.BGPalette[
              tile[tileYLine | 1]
            ];
          case 1:
            this.frameBuffer[pixelPosition] = this.BGPalette[tile[tileYLine]];
        }
      }
    }
  }

  BGGBCLayerRender(scanlineToRender: number) {
    var scrollYAdjusted = (this.backgroundY + scanlineToRender) & 0xff; //The line of the BG we're at.
    var tileYLine = (scrollYAdjusted & 7) << 3;
    var tileYDown =
      this.gfxBackgroundCHRBankPosition | ((scrollYAdjusted & 0xf8) << 2); //The row of cached tiles we're fetching from.
    var scrollXAdjusted = (this.backgroundX + this.currentX) & 0xff; //The scroll amount of the BG.
    var pixelPosition = this.pixelStart + this.currentX; //Current pixel we're working on.
    var pixelPositionEnd =
      this.pixelStart +
      (this.gfxWindowDisplay && scanlineToRender - this.windowY >= 0
        ? Math.min(Math.max(this.windowX, 0) + this.currentX, this.pixelEnd)
        : this.pixelEnd); //Make sure we do at most 160 pixels a scanline.
    var tileNumber = tileYDown + (scrollXAdjusted >> 3);
    var chrCode = this.BGCHRBank1[tileNumber];
    if (chrCode < this.gfxBackgroundBankOffset) {
      chrCode |= 0x100;
    }
    var attrCode = this.BGCHRBank2[tileNumber];
    var tile = this.tileCache[
      ((attrCode & 0x08) << 8) | ((attrCode & 0x60) << 4) | chrCode
    ];
    var palette = ((attrCode & 0x7) << 2) | ((attrCode & 0x80) >> 2);
    for (
      var texel = scrollXAdjusted & 0x7;
      texel < 8 && pixelPosition < pixelPositionEnd && scrollXAdjusted < 0x100;
      ++scrollXAdjusted
    ) {
      this.frameBuffer[pixelPosition++] = this.gbcBGPalette[
        palette | tile[tileYLine | texel++]
      ];
    }
    var scrollXAdjustedAligned =
      Math.min(pixelPositionEnd - pixelPosition, 0x100 - scrollXAdjusted) >> 3;
    scrollXAdjusted += scrollXAdjustedAligned << 3;
    scrollXAdjustedAligned += tileNumber;
    while (tileNumber < scrollXAdjustedAligned) {
      chrCode = this.BGCHRBank1[++tileNumber];
      if (chrCode < this.gfxBackgroundBankOffset) {
        chrCode |= 0x100;
      }
      attrCode = this.BGCHRBank2[tileNumber];
      tile = this.tileCache[
        ((attrCode & 0x08) << 8) | ((attrCode & 0x60) << 4) | chrCode
      ];
      palette = ((attrCode & 0x7) << 2) | ((attrCode & 0x80) >> 2);
      texel = tileYLine;
      this.frameBuffer[pixelPosition++] = this.gbcBGPalette[
        palette | tile[texel++]
      ];
      this.frameBuffer[pixelPosition++] = this.gbcBGPalette[
        palette | tile[texel++]
      ];
      this.frameBuffer[pixelPosition++] = this.gbcBGPalette[
        palette | tile[texel++]
      ];
      this.frameBuffer[pixelPosition++] = this.gbcBGPalette[
        palette | tile[texel++]
      ];
      this.frameBuffer[pixelPosition++] = this.gbcBGPalette[
        palette | tile[texel++]
      ];
      this.frameBuffer[pixelPosition++] = this.gbcBGPalette[
        palette | tile[texel++]
      ];
      this.frameBuffer[pixelPosition++] = this.gbcBGPalette[
        palette | tile[texel++]
      ];
      this.frameBuffer[pixelPosition++] = this.gbcBGPalette[
        palette | tile[texel]
      ];
    }
    if (pixelPosition < pixelPositionEnd) {
      if (scrollXAdjusted < 0x100) {
        chrCode = this.BGCHRBank1[++tileNumber];
        if (chrCode < this.gfxBackgroundBankOffset) {
          chrCode |= 0x100;
        }
        attrCode = this.BGCHRBank2[tileNumber];
        tile = this.tileCache[
          ((attrCode & 0x08) << 8) | ((attrCode & 0x60) << 4) | chrCode
        ];
        palette = ((attrCode & 0x7) << 2) | ((attrCode & 0x80) >> 2);
        for (
          texel = tileYLine - 1;
          pixelPosition < pixelPositionEnd && scrollXAdjusted < 0x100;
          ++scrollXAdjusted
        ) {
          this.frameBuffer[pixelPosition++] = this.gbcBGPalette[
            palette | tile[++texel]
          ];
        }
      }
      scrollXAdjustedAligned =
        ((pixelPositionEnd - pixelPosition) >> 3) + tileYDown;
      while (tileYDown < scrollXAdjustedAligned) {
        chrCode = this.BGCHRBank1[tileYDown];
        if (chrCode < this.gfxBackgroundBankOffset) {
          chrCode |= 0x100;
        }
        attrCode = this.BGCHRBank2[tileYDown++];
        tile = this.tileCache[
          ((attrCode & 0x08) << 8) | ((attrCode & 0x60) << 4) | chrCode
        ];
        palette = ((attrCode & 0x7) << 2) | ((attrCode & 0x80) >> 2);
        texel = tileYLine;
        this.frameBuffer[pixelPosition++] = this.gbcBGPalette[
          palette | tile[texel++]
        ];
        this.frameBuffer[pixelPosition++] = this.gbcBGPalette[
          palette | tile[texel++]
        ];
        this.frameBuffer[pixelPosition++] = this.gbcBGPalette[
          palette | tile[texel++]
        ];
        this.frameBuffer[pixelPosition++] = this.gbcBGPalette[
          palette | tile[texel++]
        ];
        this.frameBuffer[pixelPosition++] = this.gbcBGPalette[
          palette | tile[texel++]
        ];
        this.frameBuffer[pixelPosition++] = this.gbcBGPalette[
          palette | tile[texel++]
        ];
        this.frameBuffer[pixelPosition++] = this.gbcBGPalette[
          palette | tile[texel++]
        ];
        this.frameBuffer[pixelPosition++] = this.gbcBGPalette[
          palette | tile[texel]
        ];
      }
      if (pixelPosition < pixelPositionEnd) {
        chrCode = this.BGCHRBank1[tileYDown];
        if (chrCode < this.gfxBackgroundBankOffset) {
          chrCode |= 0x100;
        }
        attrCode = this.BGCHRBank2[tileYDown];
        tile = this.tileCache[
          ((attrCode & 0x08) << 8) | ((attrCode & 0x60) << 4) | chrCode
        ];
        palette = ((attrCode & 0x7) << 2) | ((attrCode & 0x80) >> 2);
        switch (pixelPositionEnd - pixelPosition) {
          case 7:
            this.frameBuffer[pixelPosition + 6] = this.gbcBGPalette[
              palette | tile[tileYLine | 6]
            ];
          case 6:
            this.frameBuffer[pixelPosition + 5] = this.gbcBGPalette[
              palette | tile[tileYLine | 5]
            ];
          case 5:
            this.frameBuffer[pixelPosition + 4] = this.gbcBGPalette[
              palette | tile[tileYLine | 4]
            ];
          case 4:
            this.frameBuffer[pixelPosition + 3] = this.gbcBGPalette[
              palette | tile[tileYLine | 3]
            ];
          case 3:
            this.frameBuffer[pixelPosition + 2] = this.gbcBGPalette[
              palette | tile[tileYLine | 2]
            ];
          case 2:
            this.frameBuffer[pixelPosition + 1] = this.gbcBGPalette[
              palette | tile[tileYLine | 1]
            ];
          case 1:
            this.frameBuffer[pixelPosition] = this.gbcBGPalette[
              palette | tile[tileYLine]
            ];
        }
      }
    }
  }

  BGGBCLayerRenderNoPriorityFlagging(scanlineToRender: number) {
    var scrollYAdjusted = (this.backgroundY + scanlineToRender) & 0xff; //The line of the BG we're at.
    var tileYLine = (scrollYAdjusted & 7) << 3;
    var tileYDown =
      this.gfxBackgroundCHRBankPosition | ((scrollYAdjusted & 0xf8) << 2); //The row of cached tiles we're fetching from.
    var scrollXAdjusted = (this.backgroundX + this.currentX) & 0xff; //The scroll amount of the BG.
    var pixelPosition = this.pixelStart + this.currentX; //Current pixel we're working on.
    var pixelPositionEnd =
      this.pixelStart +
      (this.gfxWindowDisplay && scanlineToRender - this.windowY >= 0
        ? Math.min(Math.max(this.windowX, 0) + this.currentX, this.pixelEnd)
        : this.pixelEnd); //Make sure we do at most 160 pixels a scanline.
    var tileNumber = tileYDown + (scrollXAdjusted >> 3);
    var chrCode = this.BGCHRBank1[tileNumber];
    if (chrCode < this.gfxBackgroundBankOffset) {
      chrCode |= 0x100;
    }
    var attrCode = this.BGCHRBank2[tileNumber];
    var tile = this.tileCache[
      ((attrCode & 0x08) << 8) | ((attrCode & 0x60) << 4) | chrCode
    ];
    var palette = (attrCode & 0x7) << 2;
    for (
      var texel = scrollXAdjusted & 0x7;
      texel < 8 && pixelPosition < pixelPositionEnd && scrollXAdjusted < 0x100;
      ++scrollXAdjusted
    ) {
      this.frameBuffer[pixelPosition++] = this.gbcBGPalette[
        palette | tile[tileYLine | texel++]
      ];
    }
    var scrollXAdjustedAligned =
      Math.min(pixelPositionEnd - pixelPosition, 0x100 - scrollXAdjusted) >> 3;
    scrollXAdjusted += scrollXAdjustedAligned << 3;
    scrollXAdjustedAligned += tileNumber;
    while (tileNumber < scrollXAdjustedAligned) {
      chrCode = this.BGCHRBank1[++tileNumber];
      if (chrCode < this.gfxBackgroundBankOffset) {
        chrCode |= 0x100;
      }
      attrCode = this.BGCHRBank2[tileNumber];
      tile = this.tileCache[
        ((attrCode & 0x08) << 8) | ((attrCode & 0x60) << 4) | chrCode
      ];
      palette = (attrCode & 0x7) << 2;
      texel = tileYLine;
      this.frameBuffer[pixelPosition++] = this.gbcBGPalette[
        palette | tile[texel++]
      ];
      this.frameBuffer[pixelPosition++] = this.gbcBGPalette[
        palette | tile[texel++]
      ];
      this.frameBuffer[pixelPosition++] = this.gbcBGPalette[
        palette | tile[texel++]
      ];
      this.frameBuffer[pixelPosition++] = this.gbcBGPalette[
        palette | tile[texel++]
      ];
      this.frameBuffer[pixelPosition++] = this.gbcBGPalette[
        palette | tile[texel++]
      ];
      this.frameBuffer[pixelPosition++] = this.gbcBGPalette[
        palette | tile[texel++]
      ];
      this.frameBuffer[pixelPosition++] = this.gbcBGPalette[
        palette | tile[texel++]
      ];
      this.frameBuffer[pixelPosition++] = this.gbcBGPalette[
        palette | tile[texel]
      ];
    }
    if (pixelPosition < pixelPositionEnd) {
      if (scrollXAdjusted < 0x100) {
        chrCode = this.BGCHRBank1[++tileNumber];
        if (chrCode < this.gfxBackgroundBankOffset) {
          chrCode |= 0x100;
        }
        attrCode = this.BGCHRBank2[tileNumber];
        tile = this.tileCache[
          ((attrCode & 0x08) << 8) | ((attrCode & 0x60) << 4) | chrCode
        ];
        palette = (attrCode & 0x7) << 2;
        for (
          texel = tileYLine - 1;
          pixelPosition < pixelPositionEnd && scrollXAdjusted < 0x100;
          ++scrollXAdjusted
        ) {
          this.frameBuffer[pixelPosition++] = this.gbcBGPalette[
            palette | tile[++texel]
          ];
        }
      }
      scrollXAdjustedAligned =
        ((pixelPositionEnd - pixelPosition) >> 3) + tileYDown;
      while (tileYDown < scrollXAdjustedAligned) {
        chrCode = this.BGCHRBank1[tileYDown];
        if (chrCode < this.gfxBackgroundBankOffset) {
          chrCode |= 0x100;
        }
        attrCode = this.BGCHRBank2[tileYDown++];
        tile = this.tileCache[
          ((attrCode & 0x08) << 8) | ((attrCode & 0x60) << 4) | chrCode
        ];
        palette = (attrCode & 0x7) << 2;
        texel = tileYLine;
        this.frameBuffer[pixelPosition++] = this.gbcBGPalette[
          palette | tile[texel++]
        ];
        this.frameBuffer[pixelPosition++] = this.gbcBGPalette[
          palette | tile[texel++]
        ];
        this.frameBuffer[pixelPosition++] = this.gbcBGPalette[
          palette | tile[texel++]
        ];
        this.frameBuffer[pixelPosition++] = this.gbcBGPalette[
          palette | tile[texel++]
        ];
        this.frameBuffer[pixelPosition++] = this.gbcBGPalette[
          palette | tile[texel++]
        ];
        this.frameBuffer[pixelPosition++] = this.gbcBGPalette[
          palette | tile[texel++]
        ];
        this.frameBuffer[pixelPosition++] = this.gbcBGPalette[
          palette | tile[texel++]
        ];
        this.frameBuffer[pixelPosition++] = this.gbcBGPalette[
          palette | tile[texel]
        ];
      }
      if (pixelPosition < pixelPositionEnd) {
        chrCode = this.BGCHRBank1[tileYDown];
        if (chrCode < this.gfxBackgroundBankOffset) {
          chrCode |= 0x100;
        }
        attrCode = this.BGCHRBank2[tileYDown];
        tile = this.tileCache[
          ((attrCode & 0x08) << 8) | ((attrCode & 0x60) << 4) | chrCode
        ];
        palette = (attrCode & 0x7) << 2;
        switch (pixelPositionEnd - pixelPosition) {
          case 7:
            this.frameBuffer[pixelPosition + 6] = this.gbcBGPalette[
              palette | tile[tileYLine | 6]
            ];
          case 6:
            this.frameBuffer[pixelPosition + 5] = this.gbcBGPalette[
              palette | tile[tileYLine | 5]
            ];
          case 5:
            this.frameBuffer[pixelPosition + 4] = this.gbcBGPalette[
              palette | tile[tileYLine | 4]
            ];
          case 4:
            this.frameBuffer[pixelPosition + 3] = this.gbcBGPalette[
              palette | tile[tileYLine | 3]
            ];
          case 3:
            this.frameBuffer[pixelPosition + 2] = this.gbcBGPalette[
              palette | tile[tileYLine | 2]
            ];
          case 2:
            this.frameBuffer[pixelPosition + 1] = this.gbcBGPalette[
              palette | tile[tileYLine | 1]
            ];
          case 1:
            this.frameBuffer[pixelPosition] = this.gbcBGPalette[
              palette | tile[tileYLine]
            ];
        }
      }
    }
  }

  WindowGBLayerRender(scanlineToRender: number) {
    if (this.gfxWindowDisplay) {
      //Is the window enabled?
      var scrollYAdjusted = scanlineToRender - this.windowY; //The line of the BG we're at.
      if (scrollYAdjusted >= 0) {
        var scrollXRangeAdjusted =
          this.windowX > 0 ? this.windowX + this.currentX : this.currentX;
        var pixelPosition = this.pixelStart + scrollXRangeAdjusted;
        var pixelPositionEnd = this.pixelStart + this.pixelEnd;
        if (pixelPosition < pixelPositionEnd) {
          var tileYLine = (scrollYAdjusted & 0x7) << 3;
          var tileNumber =
            (this.gfxWindowCHRBankPosition | ((scrollYAdjusted & 0xf8) << 2)) +
            (this.currentX >> 3);
          var chrCode = this.BGCHRBank1[tileNumber];
          if (chrCode < this.gfxBackgroundBankOffset) {
            chrCode |= 0x100;
          }
          var tile = this.tileCache[chrCode];
          var texel = (scrollXRangeAdjusted - this.windowX) & 0x7;
          scrollXRangeAdjusted = Math.min(
            8,
            texel + pixelPositionEnd - pixelPosition
          );
          while (texel < scrollXRangeAdjusted) {
            this.frameBuffer[pixelPosition++] = this.BGPalette[
              tile[tileYLine | texel++]
            ];
          }
          scrollXRangeAdjusted =
            tileNumber + ((pixelPositionEnd - pixelPosition) >> 3);
          while (tileNumber < scrollXRangeAdjusted) {
            chrCode = this.BGCHRBank1[++tileNumber];
            if (chrCode < this.gfxBackgroundBankOffset) {
              chrCode |= 0x100;
            }
            tile = this.tileCache[chrCode];
            texel = tileYLine;
            this.frameBuffer[pixelPosition++] = this.BGPalette[tile[texel++]];
            this.frameBuffer[pixelPosition++] = this.BGPalette[tile[texel++]];
            this.frameBuffer[pixelPosition++] = this.BGPalette[tile[texel++]];
            this.frameBuffer[pixelPosition++] = this.BGPalette[tile[texel++]];
            this.frameBuffer[pixelPosition++] = this.BGPalette[tile[texel++]];
            this.frameBuffer[pixelPosition++] = this.BGPalette[tile[texel++]];
            this.frameBuffer[pixelPosition++] = this.BGPalette[tile[texel++]];
            this.frameBuffer[pixelPosition++] = this.BGPalette[tile[texel]];
          }
          if (pixelPosition < pixelPositionEnd) {
            chrCode = this.BGCHRBank1[++tileNumber];
            if (chrCode < this.gfxBackgroundBankOffset) {
              chrCode |= 0x100;
            }
            tile = this.tileCache[chrCode];
            switch (pixelPositionEnd - pixelPosition) {
              case 7:
                this.frameBuffer[pixelPosition + 6] = this.BGPalette[
                  tile[tileYLine | 6]
                ];
              case 6:
                this.frameBuffer[pixelPosition + 5] = this.BGPalette[
                  tile[tileYLine | 5]
                ];
              case 5:
                this.frameBuffer[pixelPosition + 4] = this.BGPalette[
                  tile[tileYLine | 4]
                ];
              case 4:
                this.frameBuffer[pixelPosition + 3] = this.BGPalette[
                  tile[tileYLine | 3]
                ];
              case 3:
                this.frameBuffer[pixelPosition + 2] = this.BGPalette[
                  tile[tileYLine | 2]
                ];
              case 2:
                this.frameBuffer[pixelPosition + 1] = this.BGPalette[
                  tile[tileYLine | 1]
                ];
              case 1:
                this.frameBuffer[pixelPosition] = this.BGPalette[
                  tile[tileYLine]
                ];
            }
          }
        }
      }
    }
  }

  WindowGBCLayerRender(scanlineToRender: number) {
    if (this.gfxWindowDisplay) {
      //Is the window enabled?
      var scrollYAdjusted = scanlineToRender - this.windowY; //The line of the BG we're at.
      if (scrollYAdjusted >= 0) {
        var scrollXRangeAdjusted =
          this.windowX > 0 ? this.windowX + this.currentX : this.currentX;
        var pixelPosition = this.pixelStart + scrollXRangeAdjusted;
        var pixelPositionEnd = this.pixelStart + this.pixelEnd;
        if (pixelPosition < pixelPositionEnd) {
          var tileYLine = (scrollYAdjusted & 0x7) << 3;
          var tileNumber =
            (this.gfxWindowCHRBankPosition | ((scrollYAdjusted & 0xf8) << 2)) +
            (this.currentX >> 3);
          var chrCode = this.BGCHRBank1[tileNumber];
          if (chrCode < this.gfxBackgroundBankOffset) {
            chrCode |= 0x100;
          }
          var attrCode = this.BGCHRBank2[tileNumber];
          var tile = this.tileCache[
            ((attrCode & 0x08) << 8) | ((attrCode & 0x60) << 4) | chrCode
          ];
          var palette = ((attrCode & 0x7) << 2) | ((attrCode & 0x80) >> 2);
          var texel = (scrollXRangeAdjusted - this.windowX) & 0x7;
          scrollXRangeAdjusted = Math.min(
            8,
            texel + pixelPositionEnd - pixelPosition
          );
          while (texel < scrollXRangeAdjusted) {
            this.frameBuffer[pixelPosition++] = this.gbcBGPalette[
              palette | tile[tileYLine | texel++]
            ];
          }
          scrollXRangeAdjusted =
            tileNumber + ((pixelPositionEnd - pixelPosition) >> 3);
          while (tileNumber < scrollXRangeAdjusted) {
            chrCode = this.BGCHRBank1[++tileNumber];
            if (chrCode < this.gfxBackgroundBankOffset) {
              chrCode |= 0x100;
            }
            attrCode = this.BGCHRBank2[tileNumber];
            tile = this.tileCache[
              ((attrCode & 0x08) << 8) | ((attrCode & 0x60) << 4) | chrCode
            ];
            palette = ((attrCode & 0x7) << 2) | ((attrCode & 0x80) >> 2);
            texel = tileYLine;
            this.frameBuffer[pixelPosition++] = this.gbcBGPalette[
              palette | tile[texel++]
            ];
            this.frameBuffer[pixelPosition++] = this.gbcBGPalette[
              palette | tile[texel++]
            ];
            this.frameBuffer[pixelPosition++] = this.gbcBGPalette[
              palette | tile[texel++]
            ];
            this.frameBuffer[pixelPosition++] = this.gbcBGPalette[
              palette | tile[texel++]
            ];
            this.frameBuffer[pixelPosition++] = this.gbcBGPalette[
              palette | tile[texel++]
            ];
            this.frameBuffer[pixelPosition++] = this.gbcBGPalette[
              palette | tile[texel++]
            ];
            this.frameBuffer[pixelPosition++] = this.gbcBGPalette[
              palette | tile[texel++]
            ];
            this.frameBuffer[pixelPosition++] = this.gbcBGPalette[
              palette | tile[texel]
            ];
          }
          if (pixelPosition < pixelPositionEnd) {
            chrCode = this.BGCHRBank1[++tileNumber];
            if (chrCode < this.gfxBackgroundBankOffset) {
              chrCode |= 0x100;
            }
            attrCode = this.BGCHRBank2[tileNumber];
            tile = this.tileCache[
              ((attrCode & 0x08) << 8) | ((attrCode & 0x60) << 4) | chrCode
            ];
            palette = ((attrCode & 0x7) << 2) | ((attrCode & 0x80) >> 2);
            switch (pixelPositionEnd - pixelPosition) {
              case 7:
                this.frameBuffer[pixelPosition + 6] = this.gbcBGPalette[
                  palette | tile[tileYLine | 6]
                ];
              case 6:
                this.frameBuffer[pixelPosition + 5] = this.gbcBGPalette[
                  palette | tile[tileYLine | 5]
                ];
              case 5:
                this.frameBuffer[pixelPosition + 4] = this.gbcBGPalette[
                  palette | tile[tileYLine | 4]
                ];
              case 4:
                this.frameBuffer[pixelPosition + 3] = this.gbcBGPalette[
                  palette | tile[tileYLine | 3]
                ];
              case 3:
                this.frameBuffer[pixelPosition + 2] = this.gbcBGPalette[
                  palette | tile[tileYLine | 2]
                ];
              case 2:
                this.frameBuffer[pixelPosition + 1] = this.gbcBGPalette[
                  palette | tile[tileYLine | 1]
                ];
              case 1:
                this.frameBuffer[pixelPosition] = this.gbcBGPalette[
                  palette | tile[tileYLine]
                ];
            }
          }
        }
      }
    }
  }

  WindowGBCLayerRenderNoPriorityFlagging(scanlineToRender: number) {
    if (this.gfxWindowDisplay) {
      //Is the window enabled?
      var scrollYAdjusted = scanlineToRender - this.windowY; //The line of the BG we're at.
      if (scrollYAdjusted >= 0) {
        var scrollXRangeAdjusted =
          this.windowX > 0 ? this.windowX + this.currentX : this.currentX;
        var pixelPosition = this.pixelStart + scrollXRangeAdjusted;
        var pixelPositionEnd = this.pixelStart + this.pixelEnd;
        if (pixelPosition < pixelPositionEnd) {
          var tileYLine = (scrollYAdjusted & 0x7) << 3;
          var tileNumber =
            (this.gfxWindowCHRBankPosition | ((scrollYAdjusted & 0xf8) << 2)) +
            (this.currentX >> 3);
          var chrCode = this.BGCHRBank1[tileNumber];
          if (chrCode < this.gfxBackgroundBankOffset) {
            chrCode |= 0x100;
          }
          var attrCode = this.BGCHRBank2[tileNumber];
          var tile = this.tileCache[
            ((attrCode & 0x08) << 8) | ((attrCode & 0x60) << 4) | chrCode
          ];
          var palette = (attrCode & 0x7) << 2;
          var texel = (scrollXRangeAdjusted - this.windowX) & 0x7;
          scrollXRangeAdjusted = Math.min(
            8,
            texel + pixelPositionEnd - pixelPosition
          );
          while (texel < scrollXRangeAdjusted) {
            this.frameBuffer[pixelPosition++] = this.gbcBGPalette[
              palette | tile[tileYLine | texel++]
            ];
          }
          scrollXRangeAdjusted =
            tileNumber + ((pixelPositionEnd - pixelPosition) >> 3);
          while (tileNumber < scrollXRangeAdjusted) {
            chrCode = this.BGCHRBank1[++tileNumber];
            if (chrCode < this.gfxBackgroundBankOffset) {
              chrCode |= 0x100;
            }
            attrCode = this.BGCHRBank2[tileNumber];
            tile = this.tileCache[
              ((attrCode & 0x08) << 8) | ((attrCode & 0x60) << 4) | chrCode
            ];
            palette = (attrCode & 0x7) << 2;
            texel = tileYLine;
            this.frameBuffer[pixelPosition++] = this.gbcBGPalette[
              palette | tile[texel++]
            ];
            this.frameBuffer[pixelPosition++] = this.gbcBGPalette[
              palette | tile[texel++]
            ];
            this.frameBuffer[pixelPosition++] = this.gbcBGPalette[
              palette | tile[texel++]
            ];
            this.frameBuffer[pixelPosition++] = this.gbcBGPalette[
              palette | tile[texel++]
            ];
            this.frameBuffer[pixelPosition++] = this.gbcBGPalette[
              palette | tile[texel++]
            ];
            this.frameBuffer[pixelPosition++] = this.gbcBGPalette[
              palette | tile[texel++]
            ];
            this.frameBuffer[pixelPosition++] = this.gbcBGPalette[
              palette | tile[texel++]
            ];
            this.frameBuffer[pixelPosition++] = this.gbcBGPalette[
              palette | tile[texel]
            ];
          }
          if (pixelPosition < pixelPositionEnd) {
            chrCode = this.BGCHRBank1[++tileNumber];
            if (chrCode < this.gfxBackgroundBankOffset) {
              chrCode |= 0x100;
            }
            attrCode = this.BGCHRBank2[tileNumber];
            tile = this.tileCache[
              ((attrCode & 0x08) << 8) | ((attrCode & 0x60) << 4) | chrCode
            ];
            palette = (attrCode & 0x7) << 2;
            switch (pixelPositionEnd - pixelPosition) {
              case 7:
                this.frameBuffer[pixelPosition + 6] = this.gbcBGPalette[
                  palette | tile[tileYLine | 6]
                ];
              case 6:
                this.frameBuffer[pixelPosition + 5] = this.gbcBGPalette[
                  palette | tile[tileYLine | 5]
                ];
              case 5:
                this.frameBuffer[pixelPosition + 4] = this.gbcBGPalette[
                  palette | tile[tileYLine | 4]
                ];
              case 4:
                this.frameBuffer[pixelPosition + 3] = this.gbcBGPalette[
                  palette | tile[tileYLine | 3]
                ];
              case 3:
                this.frameBuffer[pixelPosition + 2] = this.gbcBGPalette[
                  palette | tile[tileYLine | 2]
                ];
              case 2:
                this.frameBuffer[pixelPosition + 1] = this.gbcBGPalette[
                  palette | tile[tileYLine | 1]
                ];
              case 1:
                this.frameBuffer[pixelPosition] = this.gbcBGPalette[
                  palette | tile[tileYLine]
                ];
            }
          }
        }
      }
    }
  }

  SpriteGBLayerRender(scanlineToRender: number) {
    if (this.gfxSpriteShow) {
      //Are sprites enabled?
      var lineAdjusted = scanlineToRender + 0x10;
      var OAMAddress = 0xfe00;
      var yoffset = 0;
      var xcoord = 1;
      var xCoordStart = 0;
      var xCoordEnd = 0;
      var attrCode = 0;
      var palette = 0;
      var tile = null;
      var data = 0;
      var spriteCount = 0;
      var length = 0;
      var currentPixel = 0;
      var linePixel = 0;
      //Clear our x-coord sort buffer:
      while (xcoord < 168) {
        this.sortBuffer[xcoord++] = 0xff;
      }
      if (this.gfxSpriteNormalHeight) {
        //Draw the visible sprites:
        for (
          var length = this.findLowestSpriteDrawable(lineAdjusted, 0x7);
          spriteCount < length;
          ++spriteCount
        ) {
          OAMAddress = this.OAMAddressCache[spriteCount];
          yoffset = (lineAdjusted - this.memory[OAMAddress]) << 3;
          attrCode = this.memory[OAMAddress | 3];
          palette = (attrCode & 0x10) >> 2;
          tile = this.tileCache[
            ((attrCode & 0x60) << 4) | this.memory[OAMAddress | 0x2]
          ];
          linePixel = xCoordStart = this.memory[OAMAddress | 1];
          xCoordEnd = Math.min(168 - linePixel, 8);
          xcoord = linePixel > 7 ? 0 : 8 - linePixel;
          for (
            currentPixel =
              this.pixelStart + (linePixel > 8 ? linePixel - 8 : 0);
            xcoord < xCoordEnd;
            ++xcoord, ++currentPixel, ++linePixel
          ) {
            if (this.sortBuffer[linePixel] > xCoordStart) {
              if (this.frameBuffer[currentPixel] >= 0x2000000) {
                data = tile[yoffset | xcoord];
                if (data > 0) {
                  this.frameBuffer[currentPixel] = this.OBJPalette[
                    palette | data
                  ];
                  this.sortBuffer[linePixel] = xCoordStart;
                }
              } else if (this.frameBuffer[currentPixel] < 0x1000000) {
                data = tile[yoffset | xcoord];
                if (data > 0 && attrCode < 0x80) {
                  this.frameBuffer[currentPixel] = this.OBJPalette[
                    palette | data
                  ];
                  this.sortBuffer[linePixel] = xCoordStart;
                }
              }
            }
          }
        }
      } else {
        //Draw the visible sprites:
        for (
          var length = this.findLowestSpriteDrawable(lineAdjusted, 0xf);
          spriteCount < length;
          ++spriteCount
        ) {
          OAMAddress = this.OAMAddressCache[spriteCount];
          yoffset = (lineAdjusted - this.memory[OAMAddress]) << 3;
          attrCode = this.memory[OAMAddress | 3];
          palette = (attrCode & 0x10) >> 2;
          if ((attrCode & 0x40) == (0x40 & yoffset)) {
            tile = this.tileCache[
              ((attrCode & 0x60) << 4) | (this.memory[OAMAddress | 0x2] & 0xfe)
            ];
          } else {
            tile = this.tileCache[
              ((attrCode & 0x60) << 4) | this.memory[OAMAddress | 0x2] | 1
            ];
          }
          yoffset &= 0x3f;
          linePixel = xCoordStart = this.memory[OAMAddress | 1];
          xCoordEnd = Math.min(168 - linePixel, 8);
          xcoord = linePixel > 7 ? 0 : 8 - linePixel;
          for (
            currentPixel =
              this.pixelStart + (linePixel > 8 ? linePixel - 8 : 0);
            xcoord < xCoordEnd;
            ++xcoord, ++currentPixel, ++linePixel
          ) {
            if (this.sortBuffer[linePixel] > xCoordStart) {
              if (this.frameBuffer[currentPixel] >= 0x2000000) {
                data = tile[yoffset | xcoord];
                if (data > 0) {
                  this.frameBuffer[currentPixel] = this.OBJPalette[
                    palette | data
                  ];
                  this.sortBuffer[linePixel] = xCoordStart;
                }
              } else if (this.frameBuffer[currentPixel] < 0x1000000) {
                data = tile[yoffset | xcoord];
                if (data > 0 && attrCode < 0x80) {
                  this.frameBuffer[currentPixel] = this.OBJPalette[
                    palette | data
                  ];
                  this.sortBuffer[linePixel] = xCoordStart;
                }
              }
            }
          }
        }
      }
    }
  }

  findLowestSpriteDrawable(scanlineToRender: number, drawableRange: number) {
    var address = 0xfe00;
    var spriteCount = 0;
    var diff = 0;
    while (address < 0xfea0 && spriteCount < 10) {
      diff = scanlineToRender - this.memory[address];
      if ((diff & drawableRange) == diff) {
        this.OAMAddressCache[spriteCount++] = address;
      }
      address += 4;
    }
    return spriteCount;
  }

  SpriteGBCLayerRender(scanlineToRender: number) {
    if (this.gfxSpriteShow) {
      //Are sprites enabled?
      var OAMAddress = 0xfe00;
      var lineAdjusted = scanlineToRender + 0x10;
      var yoffset = 0;
      var xcoord = 0;
      var endX = 0;
      var xCounter = 0;
      var attrCode = 0;
      var palette = 0;
      var tile = null;
      var data = 0;
      var currentPixel = 0;
      var spriteCount = 0;
      if (this.gfxSpriteNormalHeight) {
        for (; OAMAddress < 0xfea0 && spriteCount < 10; OAMAddress += 4) {
          yoffset = lineAdjusted - this.memory[OAMAddress];
          if ((yoffset & 0x7) == yoffset) {
            xcoord = this.memory[OAMAddress | 1] - 8;
            endX = Math.min(160, xcoord + 8);
            attrCode = this.memory[OAMAddress | 3];
            palette = (attrCode & 7) << 2;
            tile = this.tileCache[
              ((attrCode & 0x08) << 8) |
                ((attrCode & 0x60) << 4) |
                this.memory[OAMAddress | 2]
            ];
            xCounter = xcoord > 0 ? xcoord : 0;
            xcoord -= yoffset << 3;
            for (
              currentPixel = this.pixelStart + xCounter;
              xCounter < endX;
              ++xCounter, ++currentPixel
            ) {
              if (this.frameBuffer[currentPixel] >= 0x2000000) {
                data = tile[xCounter - xcoord];
                if (data > 0) {
                  this.frameBuffer[currentPixel] = this.gbcOBJPalette[
                    palette | data
                  ];
                }
              } else if (this.frameBuffer[currentPixel] < 0x1000000) {
                data = tile[xCounter - xcoord];
                if (data > 0 && attrCode < 0x80) {
                  //Don't optimize for attrCode, as LICM-capable JITs should optimize its checks.
                  this.frameBuffer[currentPixel] = this.gbcOBJPalette[
                    palette | data
                  ];
                }
              }
            }
            ++spriteCount;
          }
        }
      } else {
        for (; OAMAddress < 0xfea0 && spriteCount < 10; OAMAddress += 4) {
          yoffset = lineAdjusted - this.memory[OAMAddress];
          if ((yoffset & 0xf) == yoffset) {
            xcoord = this.memory[OAMAddress | 1] - 8;
            endX = Math.min(160, xcoord + 8);
            attrCode = this.memory[OAMAddress | 3];
            palette = (attrCode & 7) << 2;
            if ((attrCode & 0x40) == (0x40 & (yoffset << 3))) {
              tile = this.tileCache[
                ((attrCode & 0x08) << 8) |
                  ((attrCode & 0x60) << 4) |
                  (this.memory[OAMAddress | 0x2] & 0xfe)
              ];
            } else {
              tile = this.tileCache[
                ((attrCode & 0x08) << 8) |
                  ((attrCode & 0x60) << 4) |
                  this.memory[OAMAddress | 0x2] |
                  1
              ];
            }
            xCounter = xcoord > 0 ? xcoord : 0;
            xcoord -= (yoffset & 0x7) << 3;
            for (
              currentPixel = this.pixelStart + xCounter;
              xCounter < endX;
              ++xCounter, ++currentPixel
            ) {
              if (this.frameBuffer[currentPixel] >= 0x2000000) {
                data = tile[xCounter - xcoord];
                if (data > 0) {
                  this.frameBuffer[currentPixel] = this.gbcOBJPalette[
                    palette | data
                  ];
                }
              } else if (this.frameBuffer[currentPixel] < 0x1000000) {
                data = tile[xCounter - xcoord];
                if (data > 0 && attrCode < 0x80) {
                  //Don't optimize for attrCode, as LICM-capable JITs should optimize its checks.
                  this.frameBuffer[currentPixel] = this.gbcOBJPalette[
                    palette | data
                  ];
                }
              }
            }
            ++spriteCount;
          }
        }
      }
    }
  }

  generateGBTileLine(address: number) {
    var lineCopy =
      (this.memory[0x1 | address] << 8) | this.memory[0x9ffe & address];
    var tileBlock = this.tileCache[(address & 0x1ff0) >> 4];
    address = (address & 0xe) << 2;
    tileBlock[address | 7] = ((lineCopy & 0x100) >> 7) | (lineCopy & 0x1);
    tileBlock[address | 6] =
      ((lineCopy & 0x200) >> 8) | ((lineCopy & 0x2) >> 1);
    tileBlock[address | 5] =
      ((lineCopy & 0x400) >> 9) | ((lineCopy & 0x4) >> 2);
    tileBlock[address | 4] =
      ((lineCopy & 0x800) >> 10) | ((lineCopy & 0x8) >> 3);
    tileBlock[address | 3] =
      ((lineCopy & 0x1000) >> 11) | ((lineCopy & 0x10) >> 4);
    tileBlock[address | 2] =
      ((lineCopy & 0x2000) >> 12) | ((lineCopy & 0x20) >> 5);
    tileBlock[address | 1] =
      ((lineCopy & 0x4000) >> 13) | ((lineCopy & 0x40) >> 6);
    tileBlock[address] = ((lineCopy & 0x8000) >> 14) | ((lineCopy & 0x80) >> 7);
  }

  generateGBCTileLineBank1(address: number) {
    var lineCopy =
      (this.memory[0x1 | address] << 8) | this.memory[0x9ffe & address];
    address &= 0x1ffe;
    var tileBlock1 = this.tileCache[address >> 4];
    var tileBlock2 = this.tileCache[0x200 | (address >> 4)];
    var tileBlock3 = this.tileCache[0x400 | (address >> 4)];
    var tileBlock4 = this.tileCache[0x600 | (address >> 4)];
    address = (address & 0xe) << 2;
    var addressFlipped = 0x38 - address;
    tileBlock4[addressFlipped] = tileBlock2[address] = tileBlock3[
      addressFlipped | 7
    ] = tileBlock1[address | 7] = ((lineCopy & 0x100) >> 7) | (lineCopy & 0x1);
    tileBlock4[addressFlipped | 1] = tileBlock2[address | 1] = tileBlock3[
      addressFlipped | 6
    ] = tileBlock1[address | 6] =
      ((lineCopy & 0x200) >> 8) | ((lineCopy & 0x2) >> 1);
    tileBlock4[addressFlipped | 2] = tileBlock2[address | 2] = tileBlock3[
      addressFlipped | 5
    ] = tileBlock1[address | 5] =
      ((lineCopy & 0x400) >> 9) | ((lineCopy & 0x4) >> 2);
    tileBlock4[addressFlipped | 3] = tileBlock2[address | 3] = tileBlock3[
      addressFlipped | 4
    ] = tileBlock1[address | 4] =
      ((lineCopy & 0x800) >> 10) | ((lineCopy & 0x8) >> 3);
    tileBlock4[addressFlipped | 4] = tileBlock2[address | 4] = tileBlock3[
      addressFlipped | 3
    ] = tileBlock1[address | 3] =
      ((lineCopy & 0x1000) >> 11) | ((lineCopy & 0x10) >> 4);
    tileBlock4[addressFlipped | 5] = tileBlock2[address | 5] = tileBlock3[
      addressFlipped | 2
    ] = tileBlock1[address | 2] =
      ((lineCopy & 0x2000) >> 12) | ((lineCopy & 0x20) >> 5);
    tileBlock4[addressFlipped | 6] = tileBlock2[address | 6] = tileBlock3[
      addressFlipped | 1
    ] = tileBlock1[address | 1] =
      ((lineCopy & 0x4000) >> 13) | ((lineCopy & 0x40) >> 6);
    tileBlock4[addressFlipped | 7] = tileBlock2[address | 7] = tileBlock3[
      addressFlipped
    ] = tileBlock1[address] =
      ((lineCopy & 0x8000) >> 14) | ((lineCopy & 0x80) >> 7);
  }

  generateGBCTileBank1(vramAddress: number) {
    var address = vramAddress >> 4;
    var tileBlock1 = this.tileCache[address];
    var tileBlock2 = this.tileCache[0x200 | address];
    var tileBlock3 = this.tileCache[0x400 | address];
    var tileBlock4 = this.tileCache[0x600 | address];
    var lineCopy = 0;
    vramAddress |= 0x8000;
    address = 0;
    var addressFlipped = 56;
    do {
      lineCopy =
        (this.memory[0x1 | vramAddress] << 8) | this.memory[vramAddress];
      tileBlock4[addressFlipped] = tileBlock2[address] = tileBlock3[
        addressFlipped | 7
      ] = tileBlock1[address | 7] =
        ((lineCopy & 0x100) >> 7) | (lineCopy & 0x1);
      tileBlock4[addressFlipped | 1] = tileBlock2[address | 1] = tileBlock3[
        addressFlipped | 6
      ] = tileBlock1[address | 6] =
        ((lineCopy & 0x200) >> 8) | ((lineCopy & 0x2) >> 1);
      tileBlock4[addressFlipped | 2] = tileBlock2[address | 2] = tileBlock3[
        addressFlipped | 5
      ] = tileBlock1[address | 5] =
        ((lineCopy & 0x400) >> 9) | ((lineCopy & 0x4) >> 2);
      tileBlock4[addressFlipped | 3] = tileBlock2[address | 3] = tileBlock3[
        addressFlipped | 4
      ] = tileBlock1[address | 4] =
        ((lineCopy & 0x800) >> 10) | ((lineCopy & 0x8) >> 3);
      tileBlock4[addressFlipped | 4] = tileBlock2[address | 4] = tileBlock3[
        addressFlipped | 3
      ] = tileBlock1[address | 3] =
        ((lineCopy & 0x1000) >> 11) | ((lineCopy & 0x10) >> 4);
      tileBlock4[addressFlipped | 5] = tileBlock2[address | 5] = tileBlock3[
        addressFlipped | 2
      ] = tileBlock1[address | 2] =
        ((lineCopy & 0x2000) >> 12) | ((lineCopy & 0x20) >> 5);
      tileBlock4[addressFlipped | 6] = tileBlock2[address | 6] = tileBlock3[
        addressFlipped | 1
      ] = tileBlock1[address | 1] =
        ((lineCopy & 0x4000) >> 13) | ((lineCopy & 0x40) >> 6);
      tileBlock4[addressFlipped | 7] = tileBlock2[address | 7] = tileBlock3[
        addressFlipped
      ] = tileBlock1[address] =
        ((lineCopy & 0x8000) >> 14) | ((lineCopy & 0x80) >> 7);
      address += 8;
      addressFlipped -= 8;
      vramAddress += 2;
    } while (addressFlipped > -1);
  }

  generateGBCTileLineBank2(address: number) {
    var lineCopy =
      (this.VRAM[0x1 | address] << 8) | this.VRAM[0x1ffe & address];
    var tileBlock1 = this.tileCache[0x800 | (address >> 4)];
    var tileBlock2 = this.tileCache[0xa00 | (address >> 4)];
    var tileBlock3 = this.tileCache[0xc00 | (address >> 4)];
    var tileBlock4 = this.tileCache[0xe00 | (address >> 4)];
    address = (address & 0xe) << 2;
    var addressFlipped = 0x38 - address;
    tileBlock4[addressFlipped] = tileBlock2[address] = tileBlock3[
      addressFlipped | 7
    ] = tileBlock1[address | 7] = ((lineCopy & 0x100) >> 7) | (lineCopy & 0x1);
    tileBlock4[addressFlipped | 1] = tileBlock2[address | 1] = tileBlock3[
      addressFlipped | 6
    ] = tileBlock1[address | 6] =
      ((lineCopy & 0x200) >> 8) | ((lineCopy & 0x2) >> 1);
    tileBlock4[addressFlipped | 2] = tileBlock2[address | 2] = tileBlock3[
      addressFlipped | 5
    ] = tileBlock1[address | 5] =
      ((lineCopy & 0x400) >> 9) | ((lineCopy & 0x4) >> 2);
    tileBlock4[addressFlipped | 3] = tileBlock2[address | 3] = tileBlock3[
      addressFlipped | 4
    ] = tileBlock1[address | 4] =
      ((lineCopy & 0x800) >> 10) | ((lineCopy & 0x8) >> 3);
    tileBlock4[addressFlipped | 4] = tileBlock2[address | 4] = tileBlock3[
      addressFlipped | 3
    ] = tileBlock1[address | 3] =
      ((lineCopy & 0x1000) >> 11) | ((lineCopy & 0x10) >> 4);
    tileBlock4[addressFlipped | 5] = tileBlock2[address | 5] = tileBlock3[
      addressFlipped | 2
    ] = tileBlock1[address | 2] =
      ((lineCopy & 0x2000) >> 12) | ((lineCopy & 0x20) >> 5);
    tileBlock4[addressFlipped | 6] = tileBlock2[address | 6] = tileBlock3[
      addressFlipped | 1
    ] = tileBlock1[address | 1] =
      ((lineCopy & 0x4000) >> 13) | ((lineCopy & 0x40) >> 6);
    tileBlock4[addressFlipped | 7] = tileBlock2[address | 7] = tileBlock3[
      addressFlipped
    ] = tileBlock1[address] =
      ((lineCopy & 0x8000) >> 14) | ((lineCopy & 0x80) >> 7);
  }

  generateGBCTileBank2(vramAddress: number) {
    var address = vramAddress >> 4;
    var tileBlock1 = this.tileCache[0x800 | address];
    var tileBlock2 = this.tileCache[0xa00 | address];
    var tileBlock3 = this.tileCache[0xc00 | address];
    var tileBlock4 = this.tileCache[0xe00 | address];
    var lineCopy = 0;
    address = 0;
    var addressFlipped = 56;
    do {
      lineCopy = (this.VRAM[0x1 | vramAddress] << 8) | this.VRAM[vramAddress];
      tileBlock4[addressFlipped] = tileBlock2[address] = tileBlock3[
        addressFlipped | 7
      ] = tileBlock1[address | 7] =
        ((lineCopy & 0x100) >> 7) | (lineCopy & 0x1);
      tileBlock4[addressFlipped | 1] = tileBlock2[address | 1] = tileBlock3[
        addressFlipped | 6
      ] = tileBlock1[address | 6] =
        ((lineCopy & 0x200) >> 8) | ((lineCopy & 0x2) >> 1);
      tileBlock4[addressFlipped | 2] = tileBlock2[address | 2] = tileBlock3[
        addressFlipped | 5
      ] = tileBlock1[address | 5] =
        ((lineCopy & 0x400) >> 9) | ((lineCopy & 0x4) >> 2);
      tileBlock4[addressFlipped | 3] = tileBlock2[address | 3] = tileBlock3[
        addressFlipped | 4
      ] = tileBlock1[address | 4] =
        ((lineCopy & 0x800) >> 10) | ((lineCopy & 0x8) >> 3);
      tileBlock4[addressFlipped | 4] = tileBlock2[address | 4] = tileBlock3[
        addressFlipped | 3
      ] = tileBlock1[address | 3] =
        ((lineCopy & 0x1000) >> 11) | ((lineCopy & 0x10) >> 4);
      tileBlock4[addressFlipped | 5] = tileBlock2[address | 5] = tileBlock3[
        addressFlipped | 2
      ] = tileBlock1[address | 2] =
        ((lineCopy & 0x2000) >> 12) | ((lineCopy & 0x20) >> 5);
      tileBlock4[addressFlipped | 6] = tileBlock2[address | 6] = tileBlock3[
        addressFlipped | 1
      ] = tileBlock1[address | 1] =
        ((lineCopy & 0x4000) >> 13) | ((lineCopy & 0x40) >> 6);
      tileBlock4[addressFlipped | 7] = tileBlock2[address | 7] = tileBlock3[
        addressFlipped
      ] = tileBlock1[address] =
        ((lineCopy & 0x8000) >> 14) | ((lineCopy & 0x80) >> 7);
      address += 8;
      addressFlipped -= 8;
      vramAddress += 2;
    } while (addressFlipped > -1);
  }

  generateGBOAMTileLine(address: number) {
    var lineCopy =
      (this.memory[0x1 | address] << 8) | this.memory[0x9ffe & address];
    address &= 0x1ffe;
    var tileBlock1 = this.tileCache[address >> 4];
    var tileBlock2 = this.tileCache[0x200 | (address >> 4)];
    var tileBlock3 = this.tileCache[0x400 | (address >> 4)];
    var tileBlock4 = this.tileCache[0x600 | (address >> 4)];
    address = (address & 0xe) << 2;
    var addressFlipped = 0x38 - address;
    tileBlock4[addressFlipped] = tileBlock2[address] = tileBlock3[
      addressFlipped | 7
    ] = tileBlock1[address | 7] = ((lineCopy & 0x100) >> 7) | (lineCopy & 0x1);
    tileBlock4[addressFlipped | 1] = tileBlock2[address | 1] = tileBlock3[
      addressFlipped | 6
    ] = tileBlock1[address | 6] =
      ((lineCopy & 0x200) >> 8) | ((lineCopy & 0x2) >> 1);
    tileBlock4[addressFlipped | 2] = tileBlock2[address | 2] = tileBlock3[
      addressFlipped | 5
    ] = tileBlock1[address | 5] =
      ((lineCopy & 0x400) >> 9) | ((lineCopy & 0x4) >> 2);
    tileBlock4[addressFlipped | 3] = tileBlock2[address | 3] = tileBlock3[
      addressFlipped | 4
    ] = tileBlock1[address | 4] =
      ((lineCopy & 0x800) >> 10) | ((lineCopy & 0x8) >> 3);
    tileBlock4[addressFlipped | 4] = tileBlock2[address | 4] = tileBlock3[
      addressFlipped | 3
    ] = tileBlock1[address | 3] =
      ((lineCopy & 0x1000) >> 11) | ((lineCopy & 0x10) >> 4);
    tileBlock4[addressFlipped | 5] = tileBlock2[address | 5] = tileBlock3[
      addressFlipped | 2
    ] = tileBlock1[address | 2] =
      ((lineCopy & 0x2000) >> 12) | ((lineCopy & 0x20) >> 5);
    tileBlock4[addressFlipped | 6] = tileBlock2[address | 6] = tileBlock3[
      addressFlipped | 1
    ] = tileBlock1[address | 1] =
      ((lineCopy & 0x4000) >> 13) | ((lineCopy & 0x40) >> 6);
    tileBlock4[addressFlipped | 7] = tileBlock2[address | 7] = tileBlock3[
      addressFlipped
    ] = tileBlock1[address] =
      ((lineCopy & 0x8000) >> 14) | ((lineCopy & 0x80) >> 7);
  }

  graphicsJIT() {
    if (this.LCDisOn) {
      this.totalLinesPassed = 0; //Mark frame for ensuring a JIT pass for the next framebuffer output.
      this.graphicsJITScanlineGroup();
    }
  }

  graphicsJITVBlank() {
    //JIT the graphics to v-blank framing:
    this.totalLinesPassed += this.queuedScanLines;
    this.graphicsJITScanlineGroup();
  }

  graphicsJITScanlineGroup() {
    //Normal rendering JIT, where we try to do groups of scanlines at once:
    while (this.queuedScanLines > 0) {
      this.renderScanLine(this.lastUnrenderedLine);
      if (this.lastUnrenderedLine < 143) {
        ++this.lastUnrenderedLine;
      } else {
        this.lastUnrenderedLine = 0;
      }
      --this.queuedScanLines;
    }
  }

  incrementScanLineQueue() {
    if (this.queuedScanLines < 144) {
      ++this.queuedScanLines;
    } else {
      this.currentX = 0;
      this.midScanlineOffset = -1;
      if (this.lastUnrenderedLine < 143) {
        ++this.lastUnrenderedLine;
      } else {
        this.lastUnrenderedLine = 0;
      }
    }
  }

  midScanLineJIT() {
    this.graphicsJIT();
    this.renderMidScanLine();
  }

  launchIRQ() {
    var bitShift = 0;
    var testbit = 1;
    do {
      //Check to see if an interrupt is enabled AND requested.
      if ((testbit & this.IRQLineMatched) == testbit) {
        this.IME = false; //Reset the interrupt enabling.
        this.interruptsRequested -= testbit; //Reset the interrupt request.
        this.IRQLineMatched = 0; //Reset the IRQ assertion.
        //Interrupts have a certain clock cycle length:
        this.CPUTicks = 20;
        //Set the stack pointer to the current program counter value:
        this.stackPointer = (this.stackPointer - 1) & 0xffff;
        this.memoryWriter[this.stackPointer](
          this,
          this.stackPointer,
          this.programCounter >> 8
        );
        this.stackPointer = (this.stackPointer - 1) & 0xffff;
        this.memoryWriter[this.stackPointer](
          this,
          this.stackPointer,
          this.programCounter & 0xff
        );
        //Set the program counter to the interrupt's address:
        this.programCounter = 0x40 | (bitShift << 3);
        //Clock the core for mid-instruction updates:
        this.updateCore();
        return; //We only want the highest priority interrupt.
      }
      testbit = 1 << ++bitShift;
    } while (bitShift < 5);
  }

  checkIRQMatching() {
    if (this.IME) {
      this.IRQLineMatched =
        this.interruptsEnabled & this.interruptsRequested & 0x1f;
    }
  }

  calculateHALTPeriod() {
    //Initialize our variables and start our prediction:
    if (!this.halt) {
      this.halt = true;
      var currentClocks = -1;
      var temp_var = 0;
      if (this.LCDisOn) {
        //If the LCD is enabled, then predict the LCD IRQs enabled:
        if ((this.interruptsEnabled & 0x1) == 0x1) {
          currentClocks =
            (456 * ((this.modeSTAT == 1 ? 298 : 144) - this.actualScanLine) -
              this.LCDTicks) <<
            this.doubleSpeedShifter;
        }
        if ((this.interruptsEnabled & 0x2) == 0x2) {
          if (this.mode0TriggerSTAT) {
            temp_var =
              (this.clocksUntilMode0() - this.LCDTicks) <<
              this.doubleSpeedShifter;
            if (temp_var <= currentClocks || currentClocks == -1) {
              currentClocks = temp_var;
            }
          }
          if (this.mode1TriggerSTAT && (this.interruptsEnabled & 0x1) == 0) {
            temp_var =
              (456 * ((this.modeSTAT == 1 ? 298 : 144) - this.actualScanLine) -
                this.LCDTicks) <<
              this.doubleSpeedShifter;
            if (temp_var <= currentClocks || currentClocks == -1) {
              currentClocks = temp_var;
            }
          }
          if (this.mode2TriggerSTAT) {
            temp_var =
              ((this.actualScanLine >= 143
                ? 456 * (154 - this.actualScanLine)
                : 456) -
                this.LCDTicks) <<
              this.doubleSpeedShifter;
            if (temp_var <= currentClocks || currentClocks == -1) {
              currentClocks = temp_var;
            }
          }
          if (this.LYCMatchTriggerSTAT && this.memory[0xff45] <= 153) {
            temp_var =
              (this.clocksUntilLYCMatch() - this.LCDTicks) <<
              this.doubleSpeedShifter;
            if (temp_var <= currentClocks || currentClocks == -1) {
              currentClocks = temp_var;
            }
          }
        }
      }
      if (this.TIMAEnabled && (this.interruptsEnabled & 0x4) == 0x4) {
        //CPU timer IRQ prediction:
        temp_var =
          (0x100 - this.memory[0xff05]) * this.TACClocker - this.timerTicks;
        if (temp_var <= currentClocks || currentClocks == -1) {
          currentClocks = temp_var;
        }
      }
      if (this.serialTimer > 0 && (this.interruptsEnabled & 0x8) == 0x8) {
        //Serial IRQ prediction:
        if (this.serialTimer <= currentClocks || currentClocks == -1) {
          currentClocks = this.serialTimer;
        }
      }
    } else {
      var currentClocks = this.remainingClocks;
    }
    var maxClocks =
      (this.CPUCyclesTotal - this.emulatorTicks) << this.doubleSpeedShifter;
    if (currentClocks >= 0) {
      if (currentClocks <= maxClocks) {
        //Exit out of HALT normally:
        this.CPUTicks = Math.max(currentClocks, this.CPUTicks);
        this.updateCoreFull();
        this.halt = false;
        this.CPUTicks = 0;
      } else {
        //Still in HALT, clock only up to the clocks specified per iteration:
        this.CPUTicks = Math.max(maxClocks, this.CPUTicks);
        this.remainingClocks = currentClocks - this.CPUTicks;
      }
    } else {
      //Still in HALT, clock only up to the clocks specified per iteration:
      //Will stay in HALT forever (Stuck in HALT forever), but the APU and LCD are still clocked, so don't pause:
      this.CPUTicks += maxClocks;
    }
  }

  memoryRead(address: number) {
    //Act as a wrapper for reading the returns from the compiled jumps to memory.
    return this.memoryReader[address](this, address); //This seems to be faster than the usual if/else.
  }

  memoryHighRead(address: number) {
    //Act as a wrapper for reading the returns from the compiled jumps to memory.
    return this.memoryHighReader[address](this, address); //This seems to be faster than the usual if/else.
  }

  memoryReadJumpCompile() {
    //Faster in some browsers, since we are doing less conditionals overall by implementing them in advance.
    for (var index = 0x0000; index <= 0xffff; index++) {
      if (index < 0x4000) {
        this.memoryReader[index] = this.memoryReadNormal;
      } else if (index < 0x8000) {
        this.memoryReader[index] = this.memoryReadROM;
      } else if (index < 0x9800) {
        this.memoryReader[index] = this.cGBC
          ? this.VRAMDATAReadCGBCPU
          : this.VRAMDATAReadDMGCPU;
      } else if (index < 0xa000) {
        this.memoryReader[index] = this.cGBC
          ? this.VRAMCHRReadCGBCPU
          : this.VRAMCHRReadDMGCPU;
      } else if (index >= 0xa000 && index < 0xc000) {
        if (
          (this.numRAMBanks == 1 / 16 && index < 0xa200) ||
          this.numRAMBanks >= 1
        ) {
          if (this.cMBC7) {
            this.memoryReader[index] = this.memoryReadMBC7;
          } else if (!this.cMBC3) {
            this.memoryReader[index] = this.memoryReadMBC;
          } else {
            //MBC3 RTC + RAM:
            this.memoryReader[index] = this.memoryReadMBC3;
          }
        } else {
          this.memoryReader[index] = this.memoryReadBAD;
        }
      } else if (index >= 0xc000 && index < 0xe000) {
        if (!this.cGBC || index < 0xd000) {
          this.memoryReader[index] = this.memoryReadNormal;
        } else {
          this.memoryReader[index] = this.memoryReadGBCMemory;
        }
      } else if (index >= 0xe000 && index < 0xfe00) {
        if (!this.cGBC || index < 0xf000) {
          this.memoryReader[index] = this.memoryReadECHONormal;
        } else {
          this.memoryReader[index] = this.memoryReadECHOGBCMemory;
        }
      } else if (index < 0xfea0) {
        this.memoryReader[index] = this.memoryReadOAM;
      } else if (this.cGBC && index >= 0xfea0 && index < 0xff00) {
        this.memoryReader[index] = this.memoryReadNormal;
      } else if (index >= 0xff00) {
        switch (index) {
          case 0xff00:
            //JOYPAD:
            this.memoryHighReader[0] = this.memoryReader[0xff00] = function(
              parentObj,
              address
            ) {
              return 0xc0 | parentObj.memory[0xff00]; //Top nibble returns as set.
            };
            break;
          case 0xff01:
            //SB
            this.memoryHighReader[0x01] = this.memoryReader[0xff01] = function(
              parentObj,
              address
            ) {
              return parentObj.memory[0xff02] < 0x80
                ? parentObj.memory[0xff01]
                : 0xff;
            };
            break;
          case 0xff02:
            //SC
            if (this.cGBC) {
              this.memoryHighReader[0x02] = this.memoryReader[0xff02] = function(
                parentObj,
                address
              ) {
                return (
                  (parentObj.serialTimer <= 0 ? 0x7c : 0xfc) |
                  parentObj.memory[0xff02]
                );
              };
            } else {
              this.memoryHighReader[0x02] = this.memoryReader[0xff02] = function(
                parentObj,
                address
              ) {
                return (
                  (parentObj.serialTimer <= 0 ? 0x7e : 0xfe) |
                  parentObj.memory[0xff02]
                );
              };
            }
            break;
          case 0xff03:
            this.memoryHighReader[0x03] = this.memoryReader[0xff03] = this.memoryReadBAD;
            break;
          case 0xff04:
            //DIV
            this.memoryHighReader[0x04] = this.memoryReader[0xff04] = function(
              parentObj,
              address
            ) {
              parentObj.memory[0xff04] =
                (parentObj.memory[0xff04] + (parentObj.DIVTicks >> 8)) & 0xff;
              parentObj.DIVTicks &= 0xff;
              return parentObj.memory[0xff04];
            };
            break;
          case 0xff05:
          case 0xff06:
            this.memoryHighReader[index & 0xff] = this.memoryHighReadNormal;
            this.memoryReader[index] = this.memoryReadNormal;
            break;
          case 0xff07:
            this.memoryHighReader[0x07] = this.memoryReader[0xff07] = function(
              parentObj,
              address
            ) {
              return 0xf8 | parentObj.memory[0xff07];
            };
            break;
          case 0xff08:
          case 0xff09:
          case 0xff0a:
          case 0xff0b:
          case 0xff0c:
          case 0xff0d:
          case 0xff0e:
            this.memoryHighReader[index & 0xff] = this.memoryReader[
              index
            ] = this.memoryReadBAD;
            break;
          case 0xff0f:
            //IF
            this.memoryHighReader[0x0f] = this.memoryReader[0xff0f] = function(
              parentObj,
              address
            ) {
              return 0xe0 | parentObj.interruptsRequested;
            };
            break;
          case 0xff10:
            this.memoryHighReader[0x10] = this.memoryReader[0xff10] = function(
              parentObj,
              address
            ) {
              return 0x80 | parentObj.memory[0xff10];
            };
            break;
          case 0xff11:
            this.memoryHighReader[0x11] = this.memoryReader[0xff11] = function(
              parentObj,
              address
            ) {
              return 0x3f | parentObj.memory[0xff11];
            };
            break;
          case 0xff12:
            this.memoryHighReader[0x12] = this.memoryHighReadNormal;
            this.memoryReader[0xff12] = this.memoryReadNormal;
            break;
          case 0xff13:
            this.memoryHighReader[0x13] = this.memoryReader[0xff13] = this.memoryReadBAD;
            break;
          case 0xff14:
            this.memoryHighReader[0x14] = this.memoryReader[0xff14] = function(
              parentObj,
              address
            ) {
              return 0xbf | parentObj.memory[0xff14];
            };
            break;
          case 0xff15:
            this.memoryHighReader[0x15] = this.memoryReadBAD;
            this.memoryReader[0xff15] = this.memoryReadBAD;
            break;
          case 0xff16:
            this.memoryHighReader[0x16] = this.memoryReader[0xff16] = function(
              parentObj,
              address
            ) {
              return 0x3f | parentObj.memory[0xff16];
            };
            break;
          case 0xff17:
            this.memoryHighReader[0x17] = this.memoryHighReadNormal;
            this.memoryReader[0xff17] = this.memoryReadNormal;
            break;
          case 0xff18:
            this.memoryHighReader[0x18] = this.memoryReader[0xff18] = this.memoryReadBAD;
            break;
          case 0xff19:
            this.memoryHighReader[0x19] = this.memoryReader[0xff19] = function(
              parentObj,
              address
            ) {
              return 0xbf | parentObj.memory[0xff19];
            };
            break;
          case 0xff1a:
            this.memoryHighReader[0x1a] = this.memoryReader[0xff1a] = function(
              parentObj,
              address
            ) {
              return 0x7f | parentObj.memory[0xff1a];
            };
            break;
          case 0xff1b:
            this.memoryHighReader[0x1b] = this.memoryReader[0xff1b] = this.memoryReadBAD;
            break;
          case 0xff1c:
            this.memoryHighReader[0x1c] = this.memoryReader[0xff1c] = function(
              parentObj,
              address
            ) {
              return 0x9f | parentObj.memory[0xff1c];
            };
            break;
          case 0xff1d:
            this.memoryHighReader[0x1d] = this.memoryReader[0xff1d] = this.memoryReadBAD;
            break;
          case 0xff1e:
            this.memoryHighReader[0x1e] = this.memoryReader[0xff1e] = function(
              parentObj,
              address
            ) {
              return 0xbf | parentObj.memory[0xff1e];
            };
            break;
          case 0xff1f:
          case 0xff20:
            this.memoryHighReader[index & 0xff] = this.memoryReader[
              index
            ] = this.memoryReadBAD;
            break;
          case 0xff21:
          case 0xff22:
            this.memoryHighReader[index & 0xff] = this.memoryHighReadNormal;
            this.memoryReader[index] = this.memoryReadNormal;
            break;
          case 0xff23:
            this.memoryHighReader[0x23] = this.memoryReader[0xff23] = function(
              parentObj,
              address
            ) {
              return 0xbf | parentObj.memory[0xff23];
            };
            break;
          case 0xff24:
          case 0xff25:
            this.memoryHighReader[index & 0xff] = this.memoryHighReadNormal;
            this.memoryReader[index] = this.memoryReadNormal;
            break;
          case 0xff26:
            this.memoryHighReader[0x26] = this.memoryReader[0xff26] = function(
              parentObj,
              address
            ) {
              parentObj.audioJIT();
              return 0x70 | parentObj.memory[0xff26];
            };
            break;
          case 0xff27:
          case 0xff28:
          case 0xff29:
          case 0xff2a:
          case 0xff2b:
          case 0xff2c:
          case 0xff2d:
          case 0xff2e:
          case 0xff2f:
            this.memoryHighReader[index & 0xff] = this.memoryReader[
              index
            ] = this.memoryReadBAD;
            break;
          case 0xff30:
          case 0xff31:
          case 0xff32:
          case 0xff33:
          case 0xff34:
          case 0xff35:
          case 0xff36:
          case 0xff37:
          case 0xff38:
          case 0xff39:
          case 0xff3a:
          case 0xff3b:
          case 0xff3c:
          case 0xff3d:
          case 0xff3e:
          case 0xff3f:
            this.memoryReader[index] = function(
              parentObj: GameBoyCore,
              address: number
            ) {
              return parentObj.channel3canPlay
                ? parentObj.memory[
                    0xff00 | (parentObj.channel3lastSampleLookup >> 1)
                  ]
                : parentObj.memory[address];
            };
            this.memoryHighReader[index & 0xff] = function(
              parentObj: GameBoyCore,
              address: number
            ) {
              return parentObj.channel3canPlay
                ? parentObj.memory[
                    0xff00 | (parentObj.channel3lastSampleLookup >> 1)
                  ]
                : parentObj.memory[0xff00 | address];
            };
            break;
          case 0xff40:
            this.memoryHighReader[0x40] = this.memoryHighReadNormal;
            this.memoryReader[0xff40] = this.memoryReadNormal;
            break;
          case 0xff41:
            this.memoryHighReader[0x41] = this.memoryReader[0xff41] = function(
              parentObj,
              address
            ) {
              return 0x80 | parentObj.memory[0xff41] | parentObj.modeSTAT;
            };
            break;
          case 0xff42:
            this.memoryHighReader[0x42] = this.memoryReader[0xff42] = function(
              parentObj,
              address
            ) {
              return parentObj.backgroundY;
            };
            break;
          case 0xff43:
            this.memoryHighReader[0x43] = this.memoryReader[0xff43] = function(
              parentObj,
              address
            ) {
              return parentObj.backgroundX;
            };
            break;
          case 0xff44:
            this.memoryHighReader[0x44] = this.memoryReader[0xff44] = function(
              parentObj,
              address
            ) {
              return parentObj.LCDisOn ? parentObj.memory[0xff44] : 0;
            };
            break;
          case 0xff45:
          case 0xff46:
          case 0xff47:
          case 0xff48:
          case 0xff49:
            this.memoryHighReader[index & 0xff] = this.memoryHighReadNormal;
            this.memoryReader[index] = this.memoryReadNormal;
            break;
          case 0xff4a:
            //WY
            this.memoryHighReader[0x4a] = this.memoryReader[0xff4a] = function(
              parentObj,
              address
            ) {
              return parentObj.windowY;
            };
            break;
          case 0xff4b:
            this.memoryHighReader[0x4b] = this.memoryHighReadNormal;
            this.memoryReader[0xff4b] = this.memoryReadNormal;
            break;
          case 0xff4c:
            this.memoryHighReader[0x4c] = this.memoryReader[0xff4c] = this.memoryReadBAD;
            break;
          case 0xff4d:
            this.memoryHighReader[0x4d] = this.memoryHighReadNormal;
            this.memoryReader[0xff4d] = this.memoryReadNormal;
            break;
          case 0xff4e:
            this.memoryHighReader[0x4e] = this.memoryReader[0xff4e] = this.memoryReadBAD;
            break;
          case 0xff4f:
            this.memoryHighReader[0x4f] = this.memoryReader[0xff4f] = function(
              parentObj,
              address
            ) {
              return parentObj.currVRAMBank;
            };
            break;
          case 0xff50:
          case 0xff51:
          case 0xff52:
          case 0xff53:
          case 0xff54:
            this.memoryHighReader[index & 0xff] = this.memoryHighReadNormal;
            this.memoryReader[index] = this.memoryReadNormal;
            break;
          case 0xff55:
            if (this.cGBC) {
              this.memoryHighReader[0x55] = this.memoryReader[0xff55] = function(
                parentObj,
                address
              ) {
                if (!parentObj.LCDisOn && parentObj.hdmaRunning) {
                  //Undocumented behavior alert: HDMA becomes GDMA when LCD is off (Worms Armageddon Fix).
                  //DMA
                  parentObj.DMAWrite((parentObj.memory[0xff55] & 0x7f) + 1);
                  parentObj.memory[0xff55] = 0xff; //Transfer completed.
                  parentObj.hdmaRunning = false;
                }
                return parentObj.memory[0xff55];
              };
            } else {
              this.memoryReader[0xff55] = this.memoryReadNormal;
              this.memoryHighReader[0x55] = this.memoryHighReadNormal;
            }
            break;
          case 0xff56:
            if (this.cGBC) {
              this.memoryHighReader[0x56] = this.memoryReader[0xff56] = function(
                parentObj,
                address
              ) {
                //Return IR "not connected" status:
                return (
                  0x3c |
                  (parentObj.memory[0xff56] >= 0xc0
                    ? 0x2 | (parentObj.memory[0xff56] & 0xc1)
                    : parentObj.memory[0xff56] & 0xc3)
                );
              };
            } else {
              this.memoryReader[0xff56] = this.memoryReadNormal;
              this.memoryHighReader[0x56] = this.memoryHighReadNormal;
            }
            break;
          case 0xff57:
          case 0xff58:
          case 0xff59:
          case 0xff5a:
          case 0xff5b:
          case 0xff5c:
          case 0xff5d:
          case 0xff5e:
          case 0xff5f:
          case 0xff60:
          case 0xff61:
          case 0xff62:
          case 0xff63:
          case 0xff64:
          case 0xff65:
          case 0xff66:
          case 0xff67:
            this.memoryHighReader[index & 0xff] = this.memoryReader[
              index
            ] = this.memoryReadBAD;
            break;
          case 0xff68:
          case 0xff69:
          case 0xff6a:
          case 0xff6b:
            this.memoryHighReader[index & 0xff] = this.memoryHighReadNormal;
            this.memoryReader[index] = this.memoryReadNormal;
            break;
          case 0xff6c:
            if (this.cGBC) {
              this.memoryHighReader[0x6c] = this.memoryReader[0xff6c] = function(
                parentObj,
                address
              ) {
                return 0xfe | parentObj.memory[0xff6c];
              };
            } else {
              this.memoryHighReader[0x6c] = this.memoryReader[0xff6c] = this.memoryReadBAD;
            }
            break;
          case 0xff6d:
          case 0xff6e:
          case 0xff6f:
            this.memoryHighReader[index & 0xff] = this.memoryReader[
              index
            ] = this.memoryReadBAD;
            break;
          case 0xff70:
            if (this.cGBC) {
              //SVBK
              this.memoryHighReader[0x70] = this.memoryReader[0xff70] = function(
                parentObj,
                address
              ) {
                return 0x40 | parentObj.memory[0xff70];
              };
            } else {
              this.memoryHighReader[0x70] = this.memoryReader[0xff70] = this.memoryReadBAD;
            }
            break;
          case 0xff71:
            this.memoryHighReader[0x71] = this.memoryReader[0xff71] = this.memoryReadBAD;
            break;
          case 0xff72:
          case 0xff73:
            this.memoryHighReader[index & 0xff] = this.memoryReader[
              index
            ] = this.memoryReadNormal;
            break;
          case 0xff74:
            if (this.cGBC) {
              this.memoryHighReader[0x74] = this.memoryReader[0xff74] = this.memoryReadNormal;
            } else {
              this.memoryHighReader[0x74] = this.memoryReader[0xff74] = this.memoryReadBAD;
            }
            break;
          case 0xff75:
            this.memoryHighReader[0x75] = this.memoryReader[0xff75] = function(
              parentObj,
              address
            ) {
              return 0x8f | parentObj.memory[0xff75];
            };
            break;
          case 0xff76:
            //Undocumented realtime PCM amplitude readback:
            this.memoryHighReader[0x76] = this.memoryReader[0xff76] = function(
              parentObj,
              address
            ) {
              parentObj.audioJIT();
              return (
                (parentObj.channel2envelopeVolume << 4) |
                parentObj.channel1envelopeVolume
              );
            };
            break;
          case 0xff77:
            //Undocumented realtime PCM amplitude readback:
            this.memoryHighReader[0x77] = this.memoryReader[0xff77] = function(
              parentObj,
              address
            ) {
              parentObj.audioJIT();
              return (
                (parentObj.channel4envelopeVolume << 4) |
                parentObj.channel3envelopeVolume
              );
            };
            break;
          case 0xff78:
          case 0xff79:
          case 0xff7a:
          case 0xff7b:
          case 0xff7c:
          case 0xff7d:
          case 0xff7e:
          case 0xff7f:
            this.memoryHighReader[index & 0xff] = this.memoryReader[
              index
            ] = this.memoryReadBAD;
            break;
          case 0xffff:
            //IE
            this.memoryHighReader[0xff] = this.memoryReader[0xffff] = function(
              parentObj,
              address
            ) {
              return parentObj.interruptsEnabled;
            };
            break;
          default:
            this.memoryReader[index] = this.memoryReadNormal;
            this.memoryHighReader[index & 0xff] = this.memoryHighReadNormal;
        }
      } else {
        this.memoryReader[index] = this.memoryReadBAD;
      }
    }
  }

  memoryReadNormal(parentObj: GameBoyCore, address: number) {
    return parentObj.memory[address];
  }

  memoryHighReadNormal(parentObj: GameBoyCore, address: number) {
    return parentObj.memory[0xff00 | address];
  }

  memoryReadROM(parentObj: GameBoyCore, address: number) {
    return parentObj.ROM[parentObj.currentROMBank + address];
  }

  memoryReadMBC(parentObj: GameBoyCore, address: number) {
    //Switchable RAM
    if (parentObj.MBCRAMBanksEnabled) {
      return parentObj.MBCRam[address + parentObj.currMBCRAMBankPosition];
    }
    //cout("Reading from disabled RAM.", 1);
    return 0xff;
  }

  memoryReadMBC7(parentObj: GameBoyCore, address: number) {
    //Switchable RAM
    if (parentObj.MBCRAMBanksEnabled) {
      switch (address) {
        case 0xa000:
        case 0xa060:
        case 0xa070:
          return 0;
        case 0xa080:
          //TODO: Gyro Control Register
          return 0;
        case 0xa050:
          //Y High Byte
          return parentObj.highY;
        case 0xa040:
          //Y Low Byte
          return parentObj.lowY;
        case 0xa030:
          //X High Byte
          return parentObj.highX;
        case 0xa020:
          //X Low Byte:
          return parentObj.lowX;
        default:
          return parentObj.MBCRam[address + parentObj.currMBCRAMBankPosition];
      }
    }
    //cout("Reading from disabled RAM.", 1);
    return 0xff;
  }

  memoryReadMBC3(parentObj: GameBoyCore, address: number) {
    //Switchable RAM
    if (parentObj.MBCRAMBanksEnabled) {
      switch (parentObj.currMBCRAMBank) {
        case 0x00:
        case 0x01:
        case 0x02:
        case 0x03:
          return parentObj.MBCRam[address + parentObj.currMBCRAMBankPosition];
          break;
        case 0x08:
          return parentObj.latchedSeconds;
          break;
        case 0x09:
          return parentObj.latchedMinutes;
          break;
        case 0x0a:
          return parentObj.latchedHours;
          break;
        case 0x0b:
          return parentObj.latchedLDays;
          break;
        case 0x0c:
          return (
            (parentObj.RTCDayOverFlow ? 0x80 : 0) +
            (parentObj.RTCHALT ? 0x40 : 0) +
            parentObj.latchedHDays
          );
      }
    }
    //cout("Reading from invalid or disabled RAM.", 1);
    return 0xff;
  }

  memoryReadGBCMemory(parentObj: GameBoyCore, address: number) {
    return parentObj.GBCMemory[address + parentObj.gbcRamBankPosition];
  }

  memoryReadOAM(parentObj: GameBoyCore, address: number) {
    return parentObj.modeSTAT > 1 ? 0xff : parentObj.memory[address];
  }

  memoryReadECHOGBCMemory(parentObj: GameBoyCore, address: number) {
    return parentObj.GBCMemory[address + parentObj.gbcRamBankPositionECHO];
  }

  memoryReadECHONormal(parentObj: GameBoyCore, address: number) {
    return parentObj.memory[address - 0x2000];
  }

  memoryReadBAD(parentObj: GameBoyCore, address: number) {
    return 0xff;
  }

  VRAMDATAReadCGBCPU(parentObj: GameBoyCore, address: number) {
    //CPU Side Reading The VRAM (Optimized for GameBoy Color)
    return parentObj.modeSTAT > 2
      ? 0xff
      : parentObj.currVRAMBank == 0
      ? parentObj.memory[address]
      : parentObj.VRAM[address & 0x1fff];
  }

  VRAMDATAReadDMGCPU(parentObj: GameBoyCore, address: number) {
    //CPU Side Reading The VRAM (Optimized for classic GameBoy)
    return parentObj.modeSTAT > 2 ? 0xff : parentObj.memory[address];
  }

  VRAMCHRReadCGBCPU(parentObj: GameBoyCore, address: number) {
    //CPU Side Reading the Character Data Map:
    return parentObj.modeSTAT > 2
      ? 0xff
      : parentObj.BGCHRCurrentBank[address & 0x7ff];
  }

  VRAMCHRReadDMGCPU(parentObj: GameBoyCore, address: number) {
    //CPU Side Reading the Character Data Map:
    return parentObj.modeSTAT > 2
      ? 0xff
      : parentObj.BGCHRBank1[address & 0x7ff];
  }

  setCurrentMBC1ROMBank() {
    //Read the cartridge ROM data from RAM memory:
    switch (this.ROMBank1offs) {
      case 0x00:
      case 0x20:
      case 0x40:
      case 0x60:
        //Bank calls for 0x00, 0x20, 0x40, and 0x60 are really for 0x01, 0x21, 0x41, and 0x61.
        this.currentROMBank = this.ROMBank1offs % this.ROMBankEdge << 14;
        break;
      default:
        this.currentROMBank =
          ((this.ROMBank1offs % this.ROMBankEdge) - 1) << 14;
    }
  }

  setCurrentMBC2AND3ROMBank() {
    //Read the cartridge ROM data from RAM memory:
    //Only map bank 0 to bank 1 here (MBC2 is like MBC1, but can only do 16 banks, so only the bank 0 quirk appears for MBC2):
    this.currentROMBank =
      Math.max((this.ROMBank1offs % this.ROMBankEdge) - 1, 0) << 14;
  }

  setCurrentMBC5ROMBank() {
    //Read the cartridge ROM data from RAM memory:
    this.currentROMBank = ((this.ROMBank1offs % this.ROMBankEdge) - 1) << 14;
  }

  memoryWrite(address: number, data: number) {
    //Act as a wrapper for writing by compiled jumps to specific memory writing functions.
    this.memoryWriter[address](this, address, data);
  }

  memoryHighWrite(address: number, data: number) {
    //Act as a wrapper for writing by compiled jumps to specific memory writing functions.
    this.memoryHighWriter[address](this, address, data);
  }

  memoryWriteJumpCompile() {
    //Faster in some browsers, since we are doing less conditionals overall by implementing them in advance.
    for (var index = 0x0000; index <= 0xffff; index++) {
      if (index < 0x8000) {
        if (this.cMBC1) {
          if (index < 0x2000) {
            this.memoryWriter[index] = this.MBCWriteEnable;
          } else if (index < 0x4000) {
            this.memoryWriter[index] = this.MBC1WriteROMBank;
          } else if (index < 0x6000) {
            this.memoryWriter[index] = this.MBC1WriteRAMBank;
          } else {
            this.memoryWriter[index] = this.MBC1WriteType;
          }
        } else if (this.cMBC2) {
          if (index < 0x1000) {
            this.memoryWriter[index] = this.MBCWriteEnable;
          } else if (index >= 0x2100 && index < 0x2200) {
            this.memoryWriter[index] = this.MBC2WriteROMBank;
          } else {
            this.memoryWriter[index] = this.cartIgnoreWrite;
          }
        } else if (this.cMBC3) {
          if (index < 0x2000) {
            this.memoryWriter[index] = this.MBCWriteEnable;
          } else if (index < 0x4000) {
            this.memoryWriter[index] = this.MBC3WriteROMBank;
          } else if (index < 0x6000) {
            this.memoryWriter[index] = this.MBC3WriteRAMBank;
          } else {
            this.memoryWriter[index] = this.MBC3WriteRTCLatch;
          }
        } else if (this.cMBC5 || this.cRUMBLE || this.cMBC7) {
          if (index < 0x2000) {
            this.memoryWriter[index] = this.MBCWriteEnable;
          } else if (index < 0x3000) {
            this.memoryWriter[index] = this.MBC5WriteROMBankLow;
          } else if (index < 0x4000) {
            this.memoryWriter[index] = this.MBC5WriteROMBankHigh;
          } else if (index < 0x6000) {
            this.memoryWriter[index] = this.cRUMBLE
              ? this.RUMBLEWriteRAMBank
              : this.MBC5WriteRAMBank;
          } else {
            this.memoryWriter[index] = this.cartIgnoreWrite;
          }
        } else if (this.cHuC3) {
          if (index < 0x2000) {
            this.memoryWriter[index] = this.MBCWriteEnable;
          } else if (index < 0x4000) {
            this.memoryWriter[index] = this.MBC3WriteROMBank;
          } else if (index < 0x6000) {
            this.memoryWriter[index] = this.HuC3WriteRAMBank;
          } else {
            this.memoryWriter[index] = this.cartIgnoreWrite;
          }
        } else {
          this.memoryWriter[index] = this.cartIgnoreWrite;
        }
      } else if (index < 0x9000) {
        this.memoryWriter[index] = this.cGBC
          ? this.VRAMGBCDATAWrite
          : this.VRAMGBDATAWrite;
      } else if (index < 0x9800) {
        this.memoryWriter[index] = this.cGBC
          ? this.VRAMGBCDATAWrite
          : this.VRAMGBDATAUpperWrite;
      } else if (index < 0xa000) {
        this.memoryWriter[index] = this.cGBC
          ? this.VRAMGBCCHRMAPWrite
          : this.VRAMGBCHRMAPWrite;
      } else if (index < 0xc000) {
        if (
          (this.numRAMBanks == 1 / 16 && index < 0xa200) ||
          this.numRAMBanks >= 1
        ) {
          if (!this.cMBC3) {
            this.memoryWriter[index] = this.memoryWriteMBCRAM;
          } else {
            //MBC3 RTC + RAM:
            this.memoryWriter[index] = this.memoryWriteMBC3RAM;
          }
        } else {
          this.memoryWriter[index] = this.cartIgnoreWrite;
        }
      } else if (index < 0xe000) {
        if (this.cGBC && index >= 0xd000) {
          this.memoryWriter[index] = this.memoryWriteGBCRAM;
        } else {
          this.memoryWriter[index] = this.memoryWriteNormal;
        }
      } else if (index < 0xfe00) {
        if (this.cGBC && index >= 0xf000) {
          this.memoryWriter[index] = this.memoryWriteECHOGBCRAM;
        } else {
          this.memoryWriter[index] = this.memoryWriteECHONormal;
        }
      } else if (index <= 0xfea0) {
        this.memoryWriter[index] = this.memoryWriteOAMRAM;
      } else if (index < 0xff00) {
        if (this.cGBC) {
          //Only GBC has access to this RAM.
          this.memoryWriter[index] = this.memoryWriteNormal;
        } else {
          this.memoryWriter[index] = this.cartIgnoreWrite;
        }
      } else {
        //Start the I/O initialization by filling in the slots as normal memory:
        this.memoryWriter[index] = this.memoryWriteNormal;
        this.memoryHighWriter[index & 0xff] = this.memoryHighWriteNormal;
      }
    }
    this.registerWriteJumpCompile(); //Compile the I/O write functions separately...
  }

  MBCWriteEnable(parentObj: GameBoyCore, address: number, data: number) {
    //MBC RAM Bank Enable/Disable:
    parentObj.MBCRAMBanksEnabled = (data & 0x0f) == 0x0a; //If lower nibble is 0x0A, then enable, otherwise disable.
  }

  MBC1WriteROMBank(parentObj: GameBoyCore, address: number, data: number) {
    //MBC1 ROM bank switching:
    parentObj.ROMBank1offs = (parentObj.ROMBank1offs & 0x60) | (data & 0x1f);
    parentObj.setCurrentMBC1ROMBank();
  }

  MBC1WriteRAMBank(parentObj: GameBoyCore, address: number, data: number) {
    //MBC1 RAM bank switching
    if (parentObj.MBC1Mode) {
      //4/32 Mode
      parentObj.currMBCRAMBank = data & 0x03;
      parentObj.currMBCRAMBankPosition =
        (parentObj.currMBCRAMBank << 13) - 0xa000;
    } else {
      //16/8 Mode
      parentObj.ROMBank1offs =
        ((data & 0x03) << 5) | (parentObj.ROMBank1offs & 0x1f);
      parentObj.setCurrentMBC1ROMBank();
    }
  }

  MBC1WriteType(parentObj: GameBoyCore, address: number, data: number) {
    //MBC1 mode setting:
    parentObj.MBC1Mode = (data & 0x1) == 0x1;
    if (parentObj.MBC1Mode) {
      parentObj.ROMBank1offs &= 0x1f;
      parentObj.setCurrentMBC1ROMBank();
    } else {
      parentObj.currMBCRAMBank = 0;
      parentObj.currMBCRAMBankPosition = -0xa000;
    }
  }

  MBC2WriteROMBank(parentObj: GameBoyCore, address: number, data: number) {
    //MBC2 ROM bank switching:
    parentObj.ROMBank1offs = data & 0x0f;
    parentObj.setCurrentMBC2AND3ROMBank();
  }

  MBC3WriteROMBank(parentObj: GameBoyCore, address: number, data: number) {
    //MBC3 ROM bank switching:
    parentObj.ROMBank1offs = data & 0x7f;
    parentObj.setCurrentMBC2AND3ROMBank();
  }

  MBC3WriteRAMBank(parentObj: GameBoyCore, address: number, data: number) {
    parentObj.currMBCRAMBank = data;
    if (data < 4) {
      //MBC3 RAM bank switching
      parentObj.currMBCRAMBankPosition =
        (parentObj.currMBCRAMBank << 13) - 0xa000;
    }
  }

  MBC3WriteRTCLatch(parentObj: GameBoyCore, address: number, data: number) {
    if (data == 0) {
      parentObj.RTCisLatched = false;
    } else if (!parentObj.RTCisLatched) {
      //Copy over the current RTC time for reading.
      parentObj.RTCisLatched = true;
      parentObj.latchedSeconds = parentObj.RTCSeconds | 0;
      parentObj.latchedMinutes = parentObj.RTCMinutes;
      parentObj.latchedHours = parentObj.RTCHours;
      parentObj.latchedLDays = parentObj.RTCDays & 0xff;
      parentObj.latchedHDays = parentObj.RTCDays >> 8;
    }
  }

  MBC5WriteROMBankLow(parentObj: GameBoyCore, address: number, data: number) {
    //MBC5 ROM bank switching:
    parentObj.ROMBank1offs = (parentObj.ROMBank1offs & 0x100) | data;
    parentObj.setCurrentMBC5ROMBank();
  }

  MBC5WriteROMBankHigh(parentObj: GameBoyCore, address: number, data: number) {
    //MBC5 ROM bank switching (by least significant bit):
    parentObj.ROMBank1offs =
      ((data & 0x01) << 8) | (parentObj.ROMBank1offs & 0xff);
    parentObj.setCurrentMBC5ROMBank();
  }

  MBC5WriteRAMBank(parentObj: GameBoyCore, address: number, data: number) {
    //MBC5 RAM bank switching
    parentObj.currMBCRAMBank = data & 0xf;
    parentObj.currMBCRAMBankPosition =
      (parentObj.currMBCRAMBank << 13) - 0xa000;
  }

  RUMBLEWriteRAMBank(parentObj: GameBoyCore, address: number, data: number) {
    //MBC5 RAM bank switching
    //Like MBC5, but bit 3 of the lower nibble is used for rumbling and bit 2 is ignored.
    parentObj.currMBCRAMBank = data & 0x03;
    parentObj.currMBCRAMBankPosition =
      (parentObj.currMBCRAMBank << 13) - 0xa000;
  }

  HuC3WriteRAMBank(parentObj: GameBoyCore, address: number, data: number) {
    //HuC3 RAM bank switching
    parentObj.currMBCRAMBank = data & 0x03;
    parentObj.currMBCRAMBankPosition =
      (parentObj.currMBCRAMBank << 13) - 0xa000;
  }

  cartIgnoreWrite(parentObj: GameBoyCore, address: number, data: number) {
    //We might have encountered illegal RAM writing or such, so just do nothing...
  }

  memoryWriteNormal(parentObj: GameBoyCore, address: number, data: number) {
    parentObj.memory[address] = data;
  }

  memoryHighWriteNormal(parentObj: GameBoyCore, address: number, data: number) {
    parentObj.memory[0xff00 | address] = data;
  }

  memoryWriteMBCRAM(parentObj: GameBoyCore, address: number, data: number) {
    if (parentObj.MBCRAMBanksEnabled) {
      parentObj.MBCRam[address + parentObj.currMBCRAMBankPosition] = data;
    }
  }

  memoryWriteMBC3RAM(parentObj: GameBoyCore, address: number, data: number) {
    if (parentObj.MBCRAMBanksEnabled) {
      switch (parentObj.currMBCRAMBank) {
        case 0x00:
        case 0x01:
        case 0x02:
        case 0x03:
          parentObj.MBCRam[address + parentObj.currMBCRAMBankPosition] = data;
          break;
        case 0x08:
          if (data < 60) {
            parentObj.RTCSeconds = data;
          } else {
            cout(
              "(Bank #" +
                parentObj.currMBCRAMBank +
                ") RTC write out of range: " +
                data,
              1
            );
          }
          break;
        case 0x09:
          if (data < 60) {
            parentObj.RTCMinutes = data;
          } else {
            cout(
              "(Bank #" +
                parentObj.currMBCRAMBank +
                ") RTC write out of range: " +
                data,
              1
            );
          }
          break;
        case 0x0a:
          if (data < 24) {
            parentObj.RTCHours = data;
          } else {
            cout(
              "(Bank #" +
                parentObj.currMBCRAMBank +
                ") RTC write out of range: " +
                data,
              1
            );
          }
          break;
        case 0x0b:
          parentObj.RTCDays = (data & 0xff) | (parentObj.RTCDays & 0x100);
          break;
        case 0x0c:
          parentObj.RTCDayOverFlow = data > 0x7f;
          parentObj.RTCHALT = (data & 0x40) == 0x40;
          parentObj.RTCDays = ((data & 0x1) << 8) | (parentObj.RTCDays & 0xff);
          break;
        default:
          cout(
            "Invalid MBC3 bank address selected: " + parentObj.currMBCRAMBank,
            0
          );
      }
    }
  }

  memoryWriteGBCRAM(parentObj: GameBoyCore, address: number, data: number) {
    parentObj.GBCMemory[address + parentObj.gbcRamBankPosition] = data;
  }

  memoryWriteOAMRAM(parentObj: GameBoyCore, address: number, data: number) {
    if (parentObj.modeSTAT < 2) {
      //OAM RAM cannot be written to in mode 2 & 3
      if (parentObj.memory[address] != data) {
        parentObj.graphicsJIT();
        parentObj.memory[address] = data;
      }
    }
  }

  memoryWriteECHOGBCRAM(parentObj: GameBoyCore, address: number, data: number) {
    parentObj.GBCMemory[address + parentObj.gbcRamBankPositionECHO] = data;
  }

  memoryWriteECHONormal(parentObj: GameBoyCore, address: number, data: number) {
    parentObj.memory[address - 0x2000] = data;
  }

  VRAMGBDATAWrite(parentObj: GameBoyCore, address: number, data: number) {
    if (parentObj.modeSTAT < 3) {
      //VRAM cannot be written to during mode 3
      if (parentObj.memory[address] != data) {
        //JIT the graphics render queue:
        parentObj.graphicsJIT();
        parentObj.memory[address] = data;
        parentObj.generateGBOAMTileLine(address);
      }
    }
  }

  VRAMGBDATAUpperWrite(parentObj: GameBoyCore, address: number, data: number) {
    if (parentObj.modeSTAT < 3) {
      //VRAM cannot be written to during mode 3
      if (parentObj.memory[address] != data) {
        //JIT the graphics render queue:
        parentObj.graphicsJIT();
        parentObj.memory[address] = data;
        parentObj.generateGBTileLine(address);
      }
    }
  }

  VRAMGBCDATAWrite(parentObj: GameBoyCore, address: number, data: number) {
    if (parentObj.modeSTAT < 3) {
      //VRAM cannot be written to during mode 3
      if (parentObj.currVRAMBank == 0) {
        if (parentObj.memory[address] != data) {
          //JIT the graphics render queue:
          parentObj.graphicsJIT();
          parentObj.memory[address] = data;
          parentObj.generateGBCTileLineBank1(address);
        }
      } else {
        address &= 0x1fff;
        if (parentObj.VRAM[address] != data) {
          //JIT the graphics render queue:
          parentObj.graphicsJIT();
          parentObj.VRAM[address] = data;
          parentObj.generateGBCTileLineBank2(address);
        }
      }
    }
  }

  VRAMGBCHRMAPWrite(parentObj: GameBoyCore, address: number, data: number) {
    if (parentObj.modeSTAT < 3) {
      //VRAM cannot be written to during mode 3
      address &= 0x7ff;
      if (parentObj.BGCHRBank1[address] != data) {
        //JIT the graphics render queue:
        parentObj.graphicsJIT();
        parentObj.BGCHRBank1[address] = data;
      }
    }
  }

  VRAMGBCCHRMAPWrite(parentObj: GameBoyCore, address: number, data: number) {
    if (parentObj.modeSTAT < 3) {
      //VRAM cannot be written to during mode 3
      address &= 0x7ff;
      if (parentObj.BGCHRCurrentBank[address] != data) {
        //JIT the graphics render queue:
        parentObj.graphicsJIT();
        parentObj.BGCHRCurrentBank[address] = data;
      }
    }
  }

  DMAWrite(tilesToTransfer: number) {
    if (!this.halt) {
      //Clock the CPU for the DMA transfer (CPU is halted during the transfer):
      this.CPUTicks += 4 | ((tilesToTransfer << 5) << this.doubleSpeedShifter);
    }
    //Source address of the transfer:
    var source = (this.memory[0xff51] << 8) | this.memory[0xff52];
    //Destination address in the VRAM memory range:
    var destination = (this.memory[0xff53] << 8) | this.memory[0xff54];
    //Creating some references:
    var memoryReader = this.memoryReader;
    //JIT the graphics render queue:
    this.graphicsJIT();
    var memory = this.memory;
    //Determining which bank we're working on so we can optimize:
    if (this.currVRAMBank == 0) {
      //DMA transfer for VRAM bank 0:
      do {
        if (destination < 0x1800) {
          memory[0x8000 | destination] = memoryReader[source](this, source++);
          memory[0x8001 | destination] = memoryReader[source](this, source++);
          memory[0x8002 | destination] = memoryReader[source](this, source++);
          memory[0x8003 | destination] = memoryReader[source](this, source++);
          memory[0x8004 | destination] = memoryReader[source](this, source++);
          memory[0x8005 | destination] = memoryReader[source](this, source++);
          memory[0x8006 | destination] = memoryReader[source](this, source++);
          memory[0x8007 | destination] = memoryReader[source](this, source++);
          memory[0x8008 | destination] = memoryReader[source](this, source++);
          memory[0x8009 | destination] = memoryReader[source](this, source++);
          memory[0x800a | destination] = memoryReader[source](this, source++);
          memory[0x800b | destination] = memoryReader[source](this, source++);
          memory[0x800c | destination] = memoryReader[source](this, source++);
          memory[0x800d | destination] = memoryReader[source](this, source++);
          memory[0x800e | destination] = memoryReader[source](this, source++);
          memory[0x800f | destination] = memoryReader[source](this, source++);
          this.generateGBCTileBank1(destination);
          destination += 0x10;
        } else {
          destination &= 0x7f0;
          this.BGCHRBank1[destination++] = memoryReader[source](this, source++);
          this.BGCHRBank1[destination++] = memoryReader[source](this, source++);
          this.BGCHRBank1[destination++] = memoryReader[source](this, source++);
          this.BGCHRBank1[destination++] = memoryReader[source](this, source++);
          this.BGCHRBank1[destination++] = memoryReader[source](this, source++);
          this.BGCHRBank1[destination++] = memoryReader[source](this, source++);
          this.BGCHRBank1[destination++] = memoryReader[source](this, source++);
          this.BGCHRBank1[destination++] = memoryReader[source](this, source++);
          this.BGCHRBank1[destination++] = memoryReader[source](this, source++);
          this.BGCHRBank1[destination++] = memoryReader[source](this, source++);
          this.BGCHRBank1[destination++] = memoryReader[source](this, source++);
          this.BGCHRBank1[destination++] = memoryReader[source](this, source++);
          this.BGCHRBank1[destination++] = memoryReader[source](this, source++);
          this.BGCHRBank1[destination++] = memoryReader[source](this, source++);
          this.BGCHRBank1[destination++] = memoryReader[source](this, source++);
          this.BGCHRBank1[destination++] = memoryReader[source](this, source++);
          destination = (destination + 0x1800) & 0x1ff0;
        }
        source &= 0xfff0;
        --tilesToTransfer;
      } while (tilesToTransfer > 0);
    } else {
      var VRAM = this.VRAM;
      //DMA transfer for VRAM bank 1:
      do {
        if (destination < 0x1800) {
          VRAM[destination] = memoryReader[source](this, source++);
          VRAM[destination | 0x1] = memoryReader[source](this, source++);
          VRAM[destination | 0x2] = memoryReader[source](this, source++);
          VRAM[destination | 0x3] = memoryReader[source](this, source++);
          VRAM[destination | 0x4] = memoryReader[source](this, source++);
          VRAM[destination | 0x5] = memoryReader[source](this, source++);
          VRAM[destination | 0x6] = memoryReader[source](this, source++);
          VRAM[destination | 0x7] = memoryReader[source](this, source++);
          VRAM[destination | 0x8] = memoryReader[source](this, source++);
          VRAM[destination | 0x9] = memoryReader[source](this, source++);
          VRAM[destination | 0xa] = memoryReader[source](this, source++);
          VRAM[destination | 0xb] = memoryReader[source](this, source++);
          VRAM[destination | 0xc] = memoryReader[source](this, source++);
          VRAM[destination | 0xd] = memoryReader[source](this, source++);
          VRAM[destination | 0xe] = memoryReader[source](this, source++);
          VRAM[destination | 0xf] = memoryReader[source](this, source++);
          this.generateGBCTileBank2(destination);
          destination += 0x10;
        } else {
          destination &= 0x7f0;
          this.BGCHRBank2[destination++] = memoryReader[source](this, source++);
          this.BGCHRBank2[destination++] = memoryReader[source](this, source++);
          this.BGCHRBank2[destination++] = memoryReader[source](this, source++);
          this.BGCHRBank2[destination++] = memoryReader[source](this, source++);
          this.BGCHRBank2[destination++] = memoryReader[source](this, source++);
          this.BGCHRBank2[destination++] = memoryReader[source](this, source++);
          this.BGCHRBank2[destination++] = memoryReader[source](this, source++);
          this.BGCHRBank2[destination++] = memoryReader[source](this, source++);
          this.BGCHRBank2[destination++] = memoryReader[source](this, source++);
          this.BGCHRBank2[destination++] = memoryReader[source](this, source++);
          this.BGCHRBank2[destination++] = memoryReader[source](this, source++);
          this.BGCHRBank2[destination++] = memoryReader[source](this, source++);
          this.BGCHRBank2[destination++] = memoryReader[source](this, source++);
          this.BGCHRBank2[destination++] = memoryReader[source](this, source++);
          this.BGCHRBank2[destination++] = memoryReader[source](this, source++);
          this.BGCHRBank2[destination++] = memoryReader[source](this, source++);
          destination = (destination + 0x1800) & 0x1ff0;
        }
        source &= 0xfff0;
        --tilesToTransfer;
      } while (tilesToTransfer > 0);
    }
    //Update the HDMA registers to their next addresses:
    memory[0xff51] = source >> 8;
    memory[0xff52] = source & 0xf0;
    memory[0xff53] = destination >> 8;
    memory[0xff54] = destination & 0xf0;
  }

  registerWriteJumpCompile() {
    //I/O Registers (GB + GBC):
    //JoyPad
    this.memoryHighWriter[0] = this.memoryWriter[0xff00] = function(
      parentObj,
      address,
      data
    ) {
      parentObj.memory[0xff00] =
        (data & 0x30) |
        (((data & 0x20) == 0 ? parentObj.JoyPad >> 4 : 0xf) &
          ((data & 0x10) == 0 ? parentObj.JoyPad & 0xf : 0xf));
    };
    //SB (Serial Transfer Data)
    this.memoryHighWriter[0x1] = this.memoryWriter[0xff01] = function(
      parentObj,
      address,
      data
    ) {
      if (parentObj.memory[0xff02] < 0x80) {
        //Cannot write while a serial transfer is active.
        parentObj.memory[0xff01] = data;
      }
    };
    //SC (Serial Transfer Control):
    this.memoryHighWriter[0x2] = this.memoryHighWriteNormal;
    this.memoryWriter[0xff02] = this.memoryWriteNormal;
    //Unmapped I/O:
    this.memoryHighWriter[0x3] = this.memoryWriter[0xff03] = this.cartIgnoreWrite;
    //DIV
    this.memoryHighWriter[0x4] = this.memoryWriter[0xff04] = function(
      parentObj,
      address,
      data
    ) {
      parentObj.DIVTicks &= 0xff; //Update DIV for realignment.
      parentObj.memory[0xff04] = 0;
    };
    //TIMA
    this.memoryHighWriter[0x5] = this.memoryWriter[0xff05] = function(
      parentObj,
      address,
      data
    ) {
      parentObj.memory[0xff05] = data;
    };
    //TMA
    this.memoryHighWriter[0x6] = this.memoryWriter[0xff06] = function(
      parentObj,
      address,
      data
    ) {
      parentObj.memory[0xff06] = data;
    };
    //TAC
    this.memoryHighWriter[0x7] = this.memoryWriter[0xff07] = function(
      parentObj,
      address,
      data
    ) {
      parentObj.memory[0xff07] = data & 0x07;
      parentObj.TIMAEnabled = (data & 0x04) == 0x04;
      parentObj.TACClocker =
        Math.pow(4, (data & 0x3) != 0 ? data & 0x3 : 4) << 2; //TODO: Find a way to not make a conditional in here...
    };
    //Unmapped I/O:
    this.memoryHighWriter[0x8] = this.memoryWriter[0xff08] = this.cartIgnoreWrite;
    this.memoryHighWriter[0x9] = this.memoryWriter[0xff09] = this.cartIgnoreWrite;
    this.memoryHighWriter[0xa] = this.memoryWriter[0xff0a] = this.cartIgnoreWrite;
    this.memoryHighWriter[0xb] = this.memoryWriter[0xff0b] = this.cartIgnoreWrite;
    this.memoryHighWriter[0xc] = this.memoryWriter[0xff0c] = this.cartIgnoreWrite;
    this.memoryHighWriter[0xd] = this.memoryWriter[0xff0d] = this.cartIgnoreWrite;
    this.memoryHighWriter[0xe] = this.memoryWriter[0xff0e] = this.cartIgnoreWrite;
    //IF (Interrupt Request)
    this.memoryHighWriter[0xf] = this.memoryWriter[0xff0f] = function(
      parentObj,
      address,
      data
    ) {
      parentObj.interruptsRequested = data;
      parentObj.checkIRQMatching();
    };
    //NR10:
    this.memoryHighWriter[0x10] = this.memoryWriter[0xff10] = function(
      parentObj,
      address,
      data
    ) {
      if (parentObj.soundMasterEnabled) {
        parentObj.audioJIT();
        if (parentObj.channel1decreaseSweep && (data & 0x08) == 0) {
          if (parentObj.channel1Swept) {
            parentObj.channel1SweepFault = true;
          }
        }
        parentObj.channel1lastTimeSweep = (data & 0x70) >> 4;
        parentObj.channel1frequencySweepDivider = data & 0x07;
        parentObj.channel1decreaseSweep = (data & 0x08) == 0x08;
        parentObj.memory[0xff10] = data;
        parentObj.channel1EnableCheck();
      }
    };
    //NR11:
    this.memoryHighWriter[0x11] = this.memoryWriter[0xff11] = function(
      parentObj,
      address,
      data
    ) {
      if (parentObj.soundMasterEnabled || !parentObj.cGBC) {
        if (parentObj.soundMasterEnabled) {
          parentObj.audioJIT();
        } else {
          data &= 0x3f;
        }
        parentObj.channel1CachedDuty = parentObj.dutyLookup[data >> 6];
        parentObj.channel1totalLength = 0x40 - (data & 0x3f);
        parentObj.memory[0xff11] = data;
        parentObj.channel1EnableCheck();
      }
    };
    //NR12:
    this.memoryHighWriter[0x12] = this.memoryWriter[0xff12] = function(
      parentObj,
      address,
      data
    ) {
      if (parentObj.soundMasterEnabled) {
        parentObj.audioJIT();
        if (
          parentObj.channel1Enabled &&
          parentObj.channel1envelopeSweeps == 0
        ) {
          //Zombie Volume PAPU Bug:
          if (((parentObj.memory[0xff12] ^ data) & 0x8) == 0x8) {
            if ((parentObj.memory[0xff12] & 0x8) == 0) {
              if ((parentObj.memory[0xff12] & 0x7) == 0x7) {
                parentObj.channel1envelopeVolume += 2;
              } else {
                ++parentObj.channel1envelopeVolume;
              }
            }
            parentObj.channel1envelopeVolume =
              (16 - parentObj.channel1envelopeVolume) & 0xf;
          } else if ((parentObj.memory[0xff12] & 0xf) == 0x8) {
            parentObj.channel1envelopeVolume =
              (1 + parentObj.channel1envelopeVolume) & 0xf;
          }
          parentObj.channel1OutputLevelCache();
        }
        parentObj.channel1envelopeType = (data & 0x08) == 0x08;
        parentObj.memory[0xff12] = data;
        parentObj.channel1VolumeEnableCheck();
      }
    };
    //NR13:
    this.memoryHighWriter[0x13] = this.memoryWriter[0xff13] = function(
      parentObj,
      address,
      data
    ) {
      if (parentObj.soundMasterEnabled) {
        parentObj.audioJIT();
        parentObj.channel1frequency =
          (parentObj.channel1frequency & 0x700) | data;
        parentObj.channel1FrequencyTracker =
          (0x800 - parentObj.channel1frequency) << 2;
      }
    };
    //NR14:
    this.memoryHighWriter[0x14] = this.memoryWriter[0xff14] = function(
      parentObj,
      address,
      data
    ) {
      if (parentObj.soundMasterEnabled) {
        parentObj.audioJIT();
        parentObj.channel1consecutive = (data & 0x40) == 0x0;
        parentObj.channel1frequency =
          ((data & 0x7) << 8) | (parentObj.channel1frequency & 0xff);
        parentObj.channel1FrequencyTracker =
          (0x800 - parentObj.channel1frequency) << 2;
        if (data > 0x7f) {
          //Reload 0xFF10:
          parentObj.channel1timeSweep = parentObj.channel1lastTimeSweep;
          parentObj.channel1Swept = false;
          //Reload 0xFF12:
          var nr12 = parentObj.memory[0xff12];
          parentObj.channel1envelopeVolume = nr12 >> 4;
          parentObj.channel1OutputLevelCache();
          parentObj.channel1envelopeSweepsLast = (nr12 & 0x7) - 1;
          if (parentObj.channel1totalLength == 0) {
            parentObj.channel1totalLength = 0x40;
          }
          if (
            parentObj.channel1lastTimeSweep > 0 ||
            parentObj.channel1frequencySweepDivider > 0
          ) {
            parentObj.memory[0xff26] |= 0x1;
          } else {
            parentObj.memory[0xff26] &= 0xfe;
          }
          if ((data & 0x40) == 0x40) {
            parentObj.memory[0xff26] |= 0x1;
          }
          parentObj.channel1ShadowFrequency = parentObj.channel1frequency;
          //Reset frequency overflow check + frequency sweep type check:
          parentObj.channel1SweepFault = false;
          //Supposed to run immediately:
          parentObj.channel1AudioSweepPerformDummy();
        }
        parentObj.channel1EnableCheck();
        parentObj.memory[0xff14] = data;
      }
    };
    //NR20 (Unused I/O):
    this.memoryHighWriter[0x15] = this.memoryWriter[0xff15] = this.cartIgnoreWrite;
    //NR21:
    this.memoryHighWriter[0x16] = this.memoryWriter[0xff16] = function(
      parentObj,
      address,
      data
    ) {
      if (parentObj.soundMasterEnabled || !parentObj.cGBC) {
        if (parentObj.soundMasterEnabled) {
          parentObj.audioJIT();
        } else {
          data &= 0x3f;
        }
        parentObj.channel2CachedDuty = parentObj.dutyLookup[data >> 6];
        parentObj.channel2totalLength = 0x40 - (data & 0x3f);
        parentObj.memory[0xff16] = data;
        parentObj.channel2EnableCheck();
      }
    };
    //NR22:
    this.memoryHighWriter[0x17] = this.memoryWriter[0xff17] = function(
      parentObj,
      address,
      data
    ) {
      if (parentObj.soundMasterEnabled) {
        parentObj.audioJIT();
        if (
          parentObj.channel2Enabled &&
          parentObj.channel2envelopeSweeps == 0
        ) {
          //Zombie Volume PAPU Bug:
          if (((parentObj.memory[0xff17] ^ data) & 0x8) == 0x8) {
            if ((parentObj.memory[0xff17] & 0x8) == 0) {
              if ((parentObj.memory[0xff17] & 0x7) == 0x7) {
                parentObj.channel2envelopeVolume += 2;
              } else {
                ++parentObj.channel2envelopeVolume;
              }
            }
            parentObj.channel2envelopeVolume =
              (16 - parentObj.channel2envelopeVolume) & 0xf;
          } else if ((parentObj.memory[0xff17] & 0xf) == 0x8) {
            parentObj.channel2envelopeVolume =
              (1 + parentObj.channel2envelopeVolume) & 0xf;
          }
          parentObj.channel2OutputLevelCache();
        }
        parentObj.channel2envelopeType = (data & 0x08) == 0x08;
        parentObj.memory[0xff17] = data;
        parentObj.channel2VolumeEnableCheck();
      }
    };
    //NR23:
    this.memoryHighWriter[0x18] = this.memoryWriter[0xff18] = function(
      parentObj,
      address,
      data
    ) {
      if (parentObj.soundMasterEnabled) {
        parentObj.audioJIT();
        parentObj.channel2frequency =
          (parentObj.channel2frequency & 0x700) | data;
        parentObj.channel2FrequencyTracker =
          (0x800 - parentObj.channel2frequency) << 2;
      }
    };
    //NR24:
    this.memoryHighWriter[0x19] = this.memoryWriter[0xff19] = function(
      parentObj,
      address,
      data
    ) {
      if (parentObj.soundMasterEnabled) {
        parentObj.audioJIT();
        if (data > 0x7f) {
          //Reload 0xFF17:
          var nr22 = parentObj.memory[0xff17];
          parentObj.channel2envelopeVolume = nr22 >> 4;
          parentObj.channel2OutputLevelCache();
          parentObj.channel2envelopeSweepsLast = (nr22 & 0x7) - 1;
          if (parentObj.channel2totalLength == 0) {
            parentObj.channel2totalLength = 0x40;
          }
          if ((data & 0x40) == 0x40) {
            parentObj.memory[0xff26] |= 0x2;
          }
        }
        parentObj.channel2consecutive = (data & 0x40) == 0x0;
        parentObj.channel2frequency =
          ((data & 0x7) << 8) | (parentObj.channel2frequency & 0xff);
        parentObj.channel2FrequencyTracker =
          (0x800 - parentObj.channel2frequency) << 2;
        parentObj.memory[0xff19] = data;
        parentObj.channel2EnableCheck();
      }
    };
    //NR30:
    this.memoryHighWriter[0x1a] = this.memoryWriter[0xff1a] = function(
      parentObj,
      address,
      data
    ) {
      if (parentObj.soundMasterEnabled) {
        parentObj.audioJIT();
        if (!parentObj.channel3canPlay && data >= 0x80) {
          parentObj.channel3lastSampleLookup = 0;
          parentObj.channel3UpdateCache();
        }
        parentObj.channel3canPlay = data > 0x7f;
        if (
          parentObj.channel3canPlay &&
          parentObj.memory[0xff1a] > 0x7f &&
          !parentObj.channel3consecutive
        ) {
          parentObj.memory[0xff26] |= 0x4;
        }
        parentObj.memory[0xff1a] = data;
        //parentObj.channel3EnableCheck();
      }
    };
    //NR31:
    this.memoryHighWriter[0x1b] = this.memoryWriter[0xff1b] = function(
      parentObj,
      address,
      data
    ) {
      if (parentObj.soundMasterEnabled || !parentObj.cGBC) {
        if (parentObj.soundMasterEnabled) {
          parentObj.audioJIT();
        }
        parentObj.channel3totalLength = 0x100 - data;
        parentObj.channel3EnableCheck();
      }
    };
    //NR32:
    this.memoryHighWriter[0x1c] = this.memoryWriter[0xff1c] = function(
      parentObj,
      address,
      data
    ) {
      if (parentObj.soundMasterEnabled) {
        parentObj.audioJIT();
        data &= 0x60;
        parentObj.memory[0xff1c] = data;
        parentObj.channel3patternType = data == 0 ? 4 : (data >> 5) - 1;
      }
    };
    //NR33:
    this.memoryHighWriter[0x1d] = this.memoryWriter[0xff1d] = function(
      parentObj,
      address,
      data
    ) {
      if (parentObj.soundMasterEnabled) {
        parentObj.audioJIT();
        parentObj.channel3frequency =
          (parentObj.channel3frequency & 0x700) | data;
        parentObj.channel3FrequencyPeriod =
          (0x800 - parentObj.channel3frequency) << 1;
      }
    };
    //NR34:
    this.memoryHighWriter[0x1e] = this.memoryWriter[0xff1e] = function(
      parentObj,
      address,
      data
    ) {
      if (parentObj.soundMasterEnabled) {
        parentObj.audioJIT();
        if (data > 0x7f) {
          if (parentObj.channel3totalLength == 0) {
            parentObj.channel3totalLength = 0x100;
          }
          parentObj.channel3lastSampleLookup = 0;
          if ((data & 0x40) == 0x40) {
            parentObj.memory[0xff26] |= 0x4;
          }
        }
        parentObj.channel3consecutive = (data & 0x40) == 0x0;
        parentObj.channel3frequency =
          ((data & 0x7) << 8) | (parentObj.channel3frequency & 0xff);
        parentObj.channel3FrequencyPeriod =
          (0x800 - parentObj.channel3frequency) << 1;
        parentObj.memory[0xff1e] = data;
        parentObj.channel3EnableCheck();
      }
    };
    //NR40 (Unused I/O):
    this.memoryHighWriter[0x1f] = this.memoryWriter[0xff1f] = this.cartIgnoreWrite;
    //NR41:
    this.memoryHighWriter[0x20] = this.memoryWriter[0xff20] = function(
      parentObj,
      address,
      data
    ) {
      if (parentObj.soundMasterEnabled || !parentObj.cGBC) {
        if (parentObj.soundMasterEnabled) {
          parentObj.audioJIT();
        }
        parentObj.channel4totalLength = 0x40 - (data & 0x3f);
        parentObj.channel4EnableCheck();
      }
    };
    //NR42:
    this.memoryHighWriter[0x21] = this.memoryWriter[0xff21] = function(
      parentObj,
      address,
      data
    ) {
      if (parentObj.soundMasterEnabled) {
        parentObj.audioJIT();
        if (
          parentObj.channel4Enabled &&
          parentObj.channel4envelopeSweeps == 0
        ) {
          //Zombie Volume PAPU Bug:
          if (((parentObj.memory[0xff21] ^ data) & 0x8) == 0x8) {
            if ((parentObj.memory[0xff21] & 0x8) == 0) {
              if ((parentObj.memory[0xff21] & 0x7) == 0x7) {
                parentObj.channel4envelopeVolume += 2;
              } else {
                ++parentObj.channel4envelopeVolume;
              }
            }
            parentObj.channel4envelopeVolume =
              (16 - parentObj.channel4envelopeVolume) & 0xf;
          } else if ((parentObj.memory[0xff21] & 0xf) == 0x8) {
            parentObj.channel4envelopeVolume =
              (1 + parentObj.channel4envelopeVolume) & 0xf;
          }
          parentObj.channel4currentVolume =
            parentObj.channel4envelopeVolume << parentObj.channel4VolumeShifter;
        }
        parentObj.channel4envelopeType = (data & 0x08) == 0x08;
        parentObj.memory[0xff21] = data;
        parentObj.channel4UpdateCache();
        parentObj.channel4VolumeEnableCheck();
      }
    };
    //NR43:
    this.memoryHighWriter[0x22] = this.memoryWriter[0xff22] = function(
      parentObj,
      address,
      data
    ) {
      if (parentObj.soundMasterEnabled) {
        parentObj.audioJIT();
        parentObj.channel4FrequencyPeriod =
          Math.max((data & 0x7) << 4, 8) << (data >> 4);
        var bitWidth = data & 0x8;
        if (
          (bitWidth == 0x8 && parentObj.channel4BitRange == 0x7fff) ||
          (bitWidth == 0 && parentObj.channel4BitRange == 0x7f)
        ) {
          parentObj.channel4lastSampleLookup = 0;
          parentObj.channel4BitRange = bitWidth == 0x8 ? 0x7f : 0x7fff;
          parentObj.channel4VolumeShifter = bitWidth == 0x8 ? 7 : 15;
          parentObj.channel4currentVolume =
            parentObj.channel4envelopeVolume << parentObj.channel4VolumeShifter;
          parentObj.noiseSampleTable =
            bitWidth == 0x8 ? parentObj.LSFR7Table : parentObj.LSFR15Table;
        }
        parentObj.memory[0xff22] = data;
        parentObj.channel4UpdateCache();
      }
    };
    //NR44:
    this.memoryHighWriter[0x23] = this.memoryWriter[0xff23] = function(
      parentObj,
      address,
      data
    ) {
      if (parentObj.soundMasterEnabled) {
        parentObj.audioJIT();
        parentObj.memory[0xff23] = data;
        parentObj.channel4consecutive = (data & 0x40) == 0x0;
        if (data > 0x7f) {
          var nr42 = parentObj.memory[0xff21];
          parentObj.channel4envelopeVolume = nr42 >> 4;
          parentObj.channel4currentVolume =
            parentObj.channel4envelopeVolume << parentObj.channel4VolumeShifter;
          parentObj.channel4envelopeSweepsLast = (nr42 & 0x7) - 1;
          if (parentObj.channel4totalLength == 0) {
            parentObj.channel4totalLength = 0x40;
          }
          if ((data & 0x40) == 0x40) {
            parentObj.memory[0xff26] |= 0x8;
          }
        }
        parentObj.channel4EnableCheck();
      }
    };
    //NR50:
    this.memoryHighWriter[0x24] = this.memoryWriter[0xff24] = function(
      parentObj,
      address,
      data
    ) {
      if (parentObj.soundMasterEnabled && parentObj.memory[0xff24] != data) {
        parentObj.audioJIT();
        parentObj.memory[0xff24] = data;
        parentObj.VinLeftChannelMasterVolume = ((data >> 4) & 0x07) + 1;
        parentObj.VinRightChannelMasterVolume = (data & 0x07) + 1;
        parentObj.mixerOutputLevelCache();
      }
    };
    //NR51:
    this.memoryHighWriter[0x25] = this.memoryWriter[0xff25] = function(
      parentObj,
      address,
      data
    ) {
      if (parentObj.soundMasterEnabled && parentObj.memory[0xff25] != data) {
        parentObj.audioJIT();
        parentObj.memory[0xff25] = data;
        parentObj.rightChannel1 = (data & 0x01) == 0x01;
        parentObj.rightChannel2 = (data & 0x02) == 0x02;
        parentObj.rightChannel3 = (data & 0x04) == 0x04;
        parentObj.rightChannel4 = (data & 0x08) == 0x08;
        parentObj.leftChannel1 = (data & 0x10) == 0x10;
        parentObj.leftChannel2 = (data & 0x20) == 0x20;
        parentObj.leftChannel3 = (data & 0x40) == 0x40;
        parentObj.leftChannel4 = data > 0x7f;
        parentObj.channel1OutputLevelCache();
        parentObj.channel2OutputLevelCache();
        parentObj.channel3OutputLevelCache();
        parentObj.channel4OutputLevelCache();
      }
    };
    //NR52:
    this.memoryHighWriter[0x26] = this.memoryWriter[0xff26] = function(
      parentObj,
      address,
      data
    ) {
      parentObj.audioJIT();
      if (!parentObj.soundMasterEnabled && data > 0x7f) {
        parentObj.memory[0xff26] = 0x80;
        parentObj.soundMasterEnabled = true;
        parentObj.initializeAudioStartState();
      } else if (parentObj.soundMasterEnabled && data < 0x80) {
        parentObj.memory[0xff26] = 0;
        parentObj.soundMasterEnabled = false;
        //GBDev wiki says the registers are written with zeros on power off:
        for (var index = 0xff10; index < 0xff26; index++) {
          parentObj.memoryWriter[index](parentObj, index, 0);
        }
      }
    };
    //0xFF27 to 0xFF2F don't do anything...
    this.memoryHighWriter[0x27] = this.memoryWriter[0xff27] = this.cartIgnoreWrite;
    this.memoryHighWriter[0x28] = this.memoryWriter[0xff28] = this.cartIgnoreWrite;
    this.memoryHighWriter[0x29] = this.memoryWriter[0xff29] = this.cartIgnoreWrite;
    this.memoryHighWriter[0x2a] = this.memoryWriter[0xff2a] = this.cartIgnoreWrite;
    this.memoryHighWriter[0x2b] = this.memoryWriter[0xff2b] = this.cartIgnoreWrite;
    this.memoryHighWriter[0x2c] = this.memoryWriter[0xff2c] = this.cartIgnoreWrite;
    this.memoryHighWriter[0x2d] = this.memoryWriter[0xff2d] = this.cartIgnoreWrite;
    this.memoryHighWriter[0x2e] = this.memoryWriter[0xff2e] = this.cartIgnoreWrite;
    this.memoryHighWriter[0x2f] = this.memoryWriter[0xff2f] = this.cartIgnoreWrite;
    //WAVE PCM RAM:
    this.memoryHighWriter[0x30] = this.memoryWriter[0xff30] = function(
      parentObj,
      address,
      data
    ) {
      parentObj.channel3WriteRAM(0, data);
    };
    this.memoryHighWriter[0x31] = this.memoryWriter[0xff31] = function(
      parentObj,
      address,
      data
    ) {
      parentObj.channel3WriteRAM(0x1, data);
    };
    this.memoryHighWriter[0x32] = this.memoryWriter[0xff32] = function(
      parentObj,
      address,
      data
    ) {
      parentObj.channel3WriteRAM(0x2, data);
    };
    this.memoryHighWriter[0x33] = this.memoryWriter[0xff33] = function(
      parentObj,
      address,
      data
    ) {
      parentObj.channel3WriteRAM(0x3, data);
    };
    this.memoryHighWriter[0x34] = this.memoryWriter[0xff34] = function(
      parentObj,
      address,
      data
    ) {
      parentObj.channel3WriteRAM(0x4, data);
    };
    this.memoryHighWriter[0x35] = this.memoryWriter[0xff35] = function(
      parentObj,
      address,
      data
    ) {
      parentObj.channel3WriteRAM(0x5, data);
    };
    this.memoryHighWriter[0x36] = this.memoryWriter[0xff36] = function(
      parentObj,
      address,
      data
    ) {
      parentObj.channel3WriteRAM(0x6, data);
    };
    this.memoryHighWriter[0x37] = this.memoryWriter[0xff37] = function(
      parentObj,
      address,
      data
    ) {
      parentObj.channel3WriteRAM(0x7, data);
    };
    this.memoryHighWriter[0x38] = this.memoryWriter[0xff38] = function(
      parentObj,
      address,
      data
    ) {
      parentObj.channel3WriteRAM(0x8, data);
    };
    this.memoryHighWriter[0x39] = this.memoryWriter[0xff39] = function(
      parentObj,
      address,
      data
    ) {
      parentObj.channel3WriteRAM(0x9, data);
    };
    this.memoryHighWriter[0x3a] = this.memoryWriter[0xff3a] = function(
      parentObj,
      address,
      data
    ) {
      parentObj.channel3WriteRAM(0xa, data);
    };
    this.memoryHighWriter[0x3b] = this.memoryWriter[0xff3b] = function(
      parentObj,
      address,
      data
    ) {
      parentObj.channel3WriteRAM(0xb, data);
    };
    this.memoryHighWriter[0x3c] = this.memoryWriter[0xff3c] = function(
      parentObj,
      address,
      data
    ) {
      parentObj.channel3WriteRAM(0xc, data);
    };
    this.memoryHighWriter[0x3d] = this.memoryWriter[0xff3d] = function(
      parentObj,
      address,
      data
    ) {
      parentObj.channel3WriteRAM(0xd, data);
    };
    this.memoryHighWriter[0x3e] = this.memoryWriter[0xff3e] = function(
      parentObj,
      address,
      data
    ) {
      parentObj.channel3WriteRAM(0xe, data);
    };
    this.memoryHighWriter[0x3f] = this.memoryWriter[0xff3f] = function(
      parentObj,
      address,
      data
    ) {
      parentObj.channel3WriteRAM(0xf, data);
    };
    //SCY
    this.memoryHighWriter[0x42] = this.memoryWriter[0xff42] = function(
      parentObj,
      address,
      data
    ) {
      if (parentObj.backgroundY != data) {
        parentObj.midScanLineJIT();
        parentObj.backgroundY = data;
      }
    };
    //SCX
    this.memoryHighWriter[0x43] = this.memoryWriter[0xff43] = function(
      parentObj,
      address,
      data
    ) {
      if (parentObj.backgroundX != data) {
        parentObj.midScanLineJIT();
        parentObj.backgroundX = data;
      }
    };
    //LY
    this.memoryHighWriter[0x44] = this.memoryWriter[0xff44] = function(
      parentObj,
      address,
      data
    ) {
      //Read Only:
      if (parentObj.LCDisOn) {
        //Gambatte says to do this:
        parentObj.modeSTAT = 2;
        parentObj.midScanlineOffset = -1;
        parentObj.totalLinesPassed = parentObj.currentX = parentObj.queuedScanLines = parentObj.lastUnrenderedLine = parentObj.LCDTicks = parentObj.STATTracker = parentObj.actualScanLine = parentObj.memory[0xff44] = 0;
      }
    };
    //LYC
    this.memoryHighWriter[0x45] = this.memoryWriter[0xff45] = function(
      parentObj,
      address,
      data
    ) {
      if (parentObj.memory[0xff45] != data) {
        parentObj.memory[0xff45] = data;
        if (parentObj.LCDisOn) {
          parentObj.matchLYC(); //Get the compare of the first scan line.
        }
      }
    };
    //WY
    this.memoryHighWriter[0x4a] = this.memoryWriter[0xff4a] = function(
      parentObj,
      address,
      data
    ) {
      if (parentObj.windowY != data) {
        parentObj.midScanLineJIT();
        parentObj.windowY = data;
      }
    };
    //WX
    this.memoryHighWriter[0x4b] = this.memoryWriter[0xff4b] = function(
      parentObj,
      address,
      data
    ) {
      if (parentObj.memory[0xff4b] != data) {
        parentObj.midScanLineJIT();
        parentObj.memory[0xff4b] = data;
        parentObj.windowX = data - 7;
      }
    };
    this.memoryHighWriter[0x72] = this.memoryWriter[0xff72] = function(
      parentObj,
      address,
      data
    ) {
      parentObj.memory[0xff72] = data;
    };
    this.memoryHighWriter[0x73] = this.memoryWriter[0xff73] = function(
      parentObj,
      address,
      data
    ) {
      parentObj.memory[0xff73] = data;
    };
    this.memoryHighWriter[0x75] = this.memoryWriter[0xff75] = function(
      parentObj,
      address,
      data
    ) {
      parentObj.memory[0xff75] = data;
    };
    this.memoryHighWriter[0x76] = this.memoryWriter[0xff76] = this.cartIgnoreWrite;
    this.memoryHighWriter[0x77] = this.memoryWriter[0xff77] = this.cartIgnoreWrite;
    //IE (Interrupt Enable)
    this.memoryHighWriter[0xff] = this.memoryWriter[0xffff] = function(
      parentObj,
      address,
      data
    ) {
      parentObj.interruptsEnabled = data;
      parentObj.checkIRQMatching();
    };
    this.recompileModelSpecificIOWriteHandling();
    this.recompileBootIOWriteHandling();
  }

  recompileModelSpecificIOWriteHandling() {
    if (this.cGBC) {
      //GameBoy Color Specific I/O:
      //SC (Serial Transfer Control Register)
      this.memoryHighWriter[0x2] = this.memoryWriter[0xff02] = function(
        parentObj,
        address,
        data
      ) {
        if ((data & 0x1) == 0x1) {
          //Internal clock:
          parentObj.memory[0xff02] = data & 0x7f;
          parentObj.serialTimer = (data & 0x2) == 0 ? 4096 : 128; //Set the Serial IRQ counter.
          parentObj.serialShiftTimer = parentObj.serialShiftTimerAllocated =
            (data & 0x2) == 0 ? 512 : 16; //Set the transfer data shift counter.
        } else {
          //External clock:
          parentObj.memory[0xff02] = data;
          parentObj.serialShiftTimer = parentObj.serialShiftTimerAllocated = parentObj.serialTimer = 0; //Zero the timers, since we're emulating as if nothing is connected.
        }
      };
      this.memoryHighWriter[0x40] = this.memoryWriter[0xff40] = function(
        parentObj,
        address,
        data
      ) {
        if (parentObj.memory[0xff40] != data) {
          parentObj.midScanLineJIT();
          var temp_var = data > 0x7f;
          if (temp_var != parentObj.LCDisOn) {
            //When the display mode changes...
            parentObj.LCDisOn = temp_var;
            parentObj.memory[0xff41] &= 0x78;
            parentObj.midScanlineOffset = -1;
            parentObj.totalLinesPassed = parentObj.currentX = parentObj.queuedScanLines = parentObj.lastUnrenderedLine = parentObj.STATTracker = parentObj.LCDTicks = parentObj.actualScanLine = parentObj.memory[0xff44] = 0;
            if (parentObj.LCDisOn) {
              parentObj.modeSTAT = 2;
              parentObj.matchLYC(); //Get the compare of the first scan line.
              parentObj.LCDCONTROL = parentObj.LINECONTROL;
            } else {
              parentObj.modeSTAT = 0;
              parentObj.LCDCONTROL = parentObj.DISPLAYOFFCONTROL;
              parentObj.DisplayShowOff();
            }
            parentObj.interruptsRequested &= 0xfd;
          }
          parentObj.gfxWindowCHRBankPosition =
            (data & 0x40) == 0x40 ? 0x400 : 0;
          parentObj.gfxWindowDisplay = (data & 0x20) == 0x20;
          parentObj.gfxBackgroundBankOffset = (data & 0x10) == 0x10 ? 0 : 0x80;
          parentObj.gfxBackgroundCHRBankPosition =
            (data & 0x08) == 0x08 ? 0x400 : 0;
          parentObj.gfxSpriteNormalHeight = (data & 0x04) == 0;
          parentObj.gfxSpriteShow = (data & 0x02) == 0x02;
          parentObj.BGPriorityEnabled = (data & 0x01) == 0x01;
          parentObj.priorityFlaggingPathRebuild(); //Special case the priority flagging as an optimization.
          parentObj.memory[0xff40] = data;
        }
      };
      this.memoryHighWriter[0x41] = this.memoryWriter[0xff41] = function(
        parentObj,
        address,
        data
      ) {
        parentObj.LYCMatchTriggerSTAT = (data & 0x40) == 0x40;
        parentObj.mode2TriggerSTAT = (data & 0x20) == 0x20;
        parentObj.mode1TriggerSTAT = (data & 0x10) == 0x10;
        parentObj.mode0TriggerSTAT = (data & 0x08) == 0x08;
        parentObj.memory[0xff41] = data & 0x78;
      };
      this.memoryHighWriter[0x46] = this.memoryWriter[0xff46] = function(
        parentObj,
        address,
        data
      ) {
        parentObj.memory[0xff46] = data;
        if (data < 0xe0) {
          data <<= 8;
          address = 0xfe00;
          var stat = parentObj.modeSTAT;
          parentObj.modeSTAT = 0;
          var newData = 0;
          do {
            newData = parentObj.memoryReader[data](parentObj, data++);
            if (newData != parentObj.memory[address]) {
              //JIT the graphics render queue:
              parentObj.modeSTAT = stat;
              parentObj.graphicsJIT();
              parentObj.modeSTAT = 0;
              parentObj.memory[address++] = newData;
              break;
            }
          } while (++address < 0xfea0);
          if (address < 0xfea0) {
            do {
              parentObj.memory[address++] = parentObj.memoryReader[data](
                parentObj,
                data++
              );
              parentObj.memory[address++] = parentObj.memoryReader[data](
                parentObj,
                data++
              );
              parentObj.memory[address++] = parentObj.memoryReader[data](
                parentObj,
                data++
              );
              parentObj.memory[address++] = parentObj.memoryReader[data](
                parentObj,
                data++
              );
            } while (address < 0xfea0);
          }
          parentObj.modeSTAT = stat;
        }
      };
      //KEY1
      this.memoryHighWriter[0x4d] = this.memoryWriter[0xff4d] = function(
        parentObj,
        address,
        data
      ) {
        parentObj.memory[0xff4d] =
          (data & 0x7f) | (parentObj.memory[0xff4d] & 0x80);
      };
      this.memoryHighWriter[0x4f] = this.memoryWriter[0xff4f] = function(
        parentObj,
        address,
        data
      ) {
        parentObj.currVRAMBank = data & 0x01;
        if (parentObj.currVRAMBank > 0) {
          parentObj.BGCHRCurrentBank = parentObj.BGCHRBank2;
        } else {
          parentObj.BGCHRCurrentBank = parentObj.BGCHRBank1;
        }
        //Only writable by GBC.
      };
      this.memoryHighWriter[0x51] = this.memoryWriter[0xff51] = function(
        parentObj,
        address,
        data
      ) {
        if (!parentObj.hdmaRunning) {
          parentObj.memory[0xff51] = data;
        }
      };
      this.memoryHighWriter[0x52] = this.memoryWriter[0xff52] = function(
        parentObj,
        address,
        data
      ) {
        if (!parentObj.hdmaRunning) {
          parentObj.memory[0xff52] = data & 0xf0;
        }
      };
      this.memoryHighWriter[0x53] = this.memoryWriter[0xff53] = function(
        parentObj,
        address,
        data
      ) {
        if (!parentObj.hdmaRunning) {
          parentObj.memory[0xff53] = data & 0x1f;
        }
      };
      this.memoryHighWriter[0x54] = this.memoryWriter[0xff54] = function(
        parentObj,
        address,
        data
      ) {
        if (!parentObj.hdmaRunning) {
          parentObj.memory[0xff54] = data & 0xf0;
        }
      };
      this.memoryHighWriter[0x55] = this.memoryWriter[0xff55] = function(
        parentObj,
        address,
        data
      ) {
        if (!parentObj.hdmaRunning) {
          if ((data & 0x80) == 0) {
            //DMA
            parentObj.DMAWrite((data & 0x7f) + 1);
            parentObj.memory[0xff55] = 0xff; //Transfer completed.
          } else {
            //H-Blank DMA
            parentObj.hdmaRunning = true;
            parentObj.memory[0xff55] = data & 0x7f;
          }
        } else if ((data & 0x80) == 0) {
          //Stop H-Blank DMA
          parentObj.hdmaRunning = false;
          parentObj.memory[0xff55] |= 0x80;
        } else {
          parentObj.memory[0xff55] = data & 0x7f;
        }
      };
      this.memoryHighWriter[0x68] = this.memoryWriter[0xff68] = function(
        parentObj,
        address,
        data
      ) {
        parentObj.memory[0xff69] = parentObj.gbcBGRawPalette[data & 0x3f];
        parentObj.memory[0xff68] = data;
      };
      this.memoryHighWriter[0x69] = this.memoryWriter[0xff69] = function(
        parentObj,
        address,
        data
      ) {
        parentObj.updateGBCBGPalette(parentObj.memory[0xff68] & 0x3f, data);
        if (parentObj.memory[0xff68] > 0x7f) {
          // high bit = autoincrement
          var next = (parentObj.memory[0xff68] + 1) & 0x3f;
          parentObj.memory[0xff68] = next | 0x80;
          parentObj.memory[0xff69] = parentObj.gbcBGRawPalette[next];
        } else {
          parentObj.memory[0xff69] = data;
        }
      };
      this.memoryHighWriter[0x6a] = this.memoryWriter[0xff6a] = function(
        parentObj,
        address,
        data
      ) {
        parentObj.memory[0xff6b] = parentObj.gbcOBJRawPalette[data & 0x3f];
        parentObj.memory[0xff6a] = data;
      };
      this.memoryHighWriter[0x6b] = this.memoryWriter[0xff6b] = function(
        parentObj,
        address,
        data
      ) {
        parentObj.updateGBCOBJPalette(parentObj.memory[0xff6a] & 0x3f, data);
        if (parentObj.memory[0xff6a] > 0x7f) {
          // high bit = autoincrement
          var next = (parentObj.memory[0xff6a] + 1) & 0x3f;
          parentObj.memory[0xff6a] = next | 0x80;
          parentObj.memory[0xff6b] = parentObj.gbcOBJRawPalette[next];
        } else {
          parentObj.memory[0xff6b] = data;
        }
      };
      //SVBK
      this.memoryHighWriter[0x70] = this.memoryWriter[0xff70] = function(
        parentObj,
        address,
        data
      ) {
        var addressCheck =
          (parentObj.memory[0xff51] << 8) | parentObj.memory[0xff52]; //Cannot change the RAM bank while WRAM is the source of a running HDMA.
        if (
          !parentObj.hdmaRunning ||
          addressCheck < 0xd000 ||
          addressCheck >= 0xe000
        ) {
          parentObj.gbcRamBank = Math.max(data & 0x07, 1); //Bank range is from 1-7
          parentObj.gbcRamBankPosition =
            ((parentObj.gbcRamBank - 1) << 12) - 0xd000;
          parentObj.gbcRamBankPositionECHO =
            parentObj.gbcRamBankPosition - 0x2000;
        }
        parentObj.memory[0xff70] = data; //Bit 6 cannot be written to.
      };
      this.memoryHighWriter[0x74] = this.memoryWriter[0xff74] = function(
        parentObj,
        address,
        data
      ) {
        parentObj.memory[0xff74] = data;
      };
    } else {
      //Fill in the GameBoy Color I/O registers as normal RAM for GameBoy compatibility:
      //SC (Serial Transfer Control Register)
      this.memoryHighWriter[0x2] = this.memoryWriter[0xff02] = function(
        parentObj,
        address,
        data
      ) {
        if ((data & 0x1) == 0x1) {
          //Internal clock:
          parentObj.memory[0xff02] = data & 0x7f;
          parentObj.serialTimer = 4096; //Set the Serial IRQ counter.
          parentObj.serialShiftTimer = parentObj.serialShiftTimerAllocated = 512; //Set the transfer data shift counter.
        } else {
          //External clock:
          parentObj.memory[0xff02] = data;
          parentObj.serialShiftTimer = parentObj.serialShiftTimerAllocated = parentObj.serialTimer = 0; //Zero the timers, since we're emulating as if nothing is connected.
        }
      };
      this.memoryHighWriter[0x40] = this.memoryWriter[0xff40] = function(
        parentObj,
        address,
        data
      ) {
        if (parentObj.memory[0xff40] != data) {
          parentObj.midScanLineJIT();
          var temp_var = data > 0x7f;
          if (temp_var != parentObj.LCDisOn) {
            //When the display mode changes...
            parentObj.LCDisOn = temp_var;
            parentObj.memory[0xff41] &= 0x78;
            parentObj.midScanlineOffset = -1;
            parentObj.totalLinesPassed = parentObj.currentX = parentObj.queuedScanLines = parentObj.lastUnrenderedLine = parentObj.STATTracker = parentObj.LCDTicks = parentObj.actualScanLine = parentObj.memory[0xff44] = 0;
            if (parentObj.LCDisOn) {
              parentObj.modeSTAT = 2;
              parentObj.matchLYC(); //Get the compare of the first scan line.
              parentObj.LCDCONTROL = parentObj.LINECONTROL;
            } else {
              parentObj.modeSTAT = 0;
              parentObj.LCDCONTROL = parentObj.DISPLAYOFFCONTROL;
              parentObj.DisplayShowOff();
            }
            parentObj.interruptsRequested &= 0xfd;
          }
          parentObj.gfxWindowCHRBankPosition =
            (data & 0x40) == 0x40 ? 0x400 : 0;
          parentObj.gfxWindowDisplay = (data & 0x20) == 0x20;
          parentObj.gfxBackgroundBankOffset = (data & 0x10) == 0x10 ? 0 : 0x80;
          parentObj.gfxBackgroundCHRBankPosition =
            (data & 0x08) == 0x08 ? 0x400 : 0;
          parentObj.gfxSpriteNormalHeight = (data & 0x04) == 0;
          parentObj.gfxSpriteShow = (data & 0x02) == 0x02;
          parentObj.bgEnabled = (data & 0x01) == 0x01;
          parentObj.memory[0xff40] = data;
        }
      };
      this.memoryHighWriter[0x41] = this.memoryWriter[0xff41] = function(
        parentObj,
        address,
        data
      ) {
        parentObj.LYCMatchTriggerSTAT = (data & 0x40) == 0x40;
        parentObj.mode2TriggerSTAT = (data & 0x20) == 0x20;
        parentObj.mode1TriggerSTAT = (data & 0x10) == 0x10;
        parentObj.mode0TriggerSTAT = (data & 0x08) == 0x08;
        parentObj.memory[0xff41] = data & 0x78;
        if (
          (!parentObj.usedBootROM || !parentObj.usedGBCBootROM) &&
          parentObj.LCDisOn &&
          parentObj.modeSTAT < 2
        ) {
          parentObj.interruptsRequested |= 0x2;
          parentObj.checkIRQMatching();
        }
      };
      this.memoryHighWriter[0x46] = this.memoryWriter[0xff46] = function(
        parentObj,
        address,
        data
      ) {
        parentObj.memory[0xff46] = data;
        if (data > 0x7f && data < 0xe0) {
          //DMG cannot DMA from the ROM banks.
          data <<= 8;
          address = 0xfe00;
          var stat = parentObj.modeSTAT;
          parentObj.modeSTAT = 0;
          var newData = 0;
          do {
            newData = parentObj.memoryReader[data](parentObj, data++);
            if (newData != parentObj.memory[address]) {
              //JIT the graphics render queue:
              parentObj.modeSTAT = stat;
              parentObj.graphicsJIT();
              parentObj.modeSTAT = 0;
              parentObj.memory[address++] = newData;
              break;
            }
          } while (++address < 0xfea0);
          if (address < 0xfea0) {
            do {
              parentObj.memory[address++] = parentObj.memoryReader[data](
                parentObj,
                data++
              );
              parentObj.memory[address++] = parentObj.memoryReader[data](
                parentObj,
                data++
              );
              parentObj.memory[address++] = parentObj.memoryReader[data](
                parentObj,
                data++
              );
              parentObj.memory[address++] = parentObj.memoryReader[data](
                parentObj,
                data++
              );
            } while (address < 0xfea0);
          }
          parentObj.modeSTAT = stat;
        }
      };
      this.memoryHighWriter[0x47] = this.memoryWriter[0xff47] = function(
        parentObj,
        address,
        data
      ) {
        if (parentObj.memory[0xff47] != data) {
          parentObj.midScanLineJIT();
          parentObj.updateGBBGPalette(data);
          parentObj.memory[0xff47] = data;
        }
      };
      this.memoryHighWriter[0x48] = this.memoryWriter[0xff48] = function(
        parentObj,
        address,
        data
      ) {
        if (parentObj.memory[0xff48] != data) {
          parentObj.midScanLineJIT();
          parentObj.updateGBOBJPalette(0, data);
          parentObj.memory[0xff48] = data;
        }
      };
      this.memoryHighWriter[0x49] = this.memoryWriter[0xff49] = function(
        parentObj,
        address,
        data
      ) {
        if (parentObj.memory[0xff49] != data) {
          parentObj.midScanLineJIT();
          parentObj.updateGBOBJPalette(4, data);
          parentObj.memory[0xff49] = data;
        }
      };
      this.memoryHighWriter[0x4d] = this.memoryWriter[0xff4d] = function(
        parentObj,
        address,
        data
      ) {
        parentObj.memory[0xff4d] = data;
      };
      this.memoryHighWriter[0x4f] = this.memoryWriter[0xff4f] = this.cartIgnoreWrite; //Not writable in DMG mode.
      this.memoryHighWriter[0x55] = this.memoryWriter[0xff55] = this.cartIgnoreWrite;
      this.memoryHighWriter[0x68] = this.memoryWriter[0xff68] = this.cartIgnoreWrite;
      this.memoryHighWriter[0x69] = this.memoryWriter[0xff69] = this.cartIgnoreWrite;
      this.memoryHighWriter[0x6a] = this.memoryWriter[0xff6a] = this.cartIgnoreWrite;
      this.memoryHighWriter[0x6b] = this.memoryWriter[0xff6b] = this.cartIgnoreWrite;
      this.memoryHighWriter[0x6c] = this.memoryWriter[0xff6c] = this.cartIgnoreWrite;
      this.memoryHighWriter[0x70] = this.memoryWriter[0xff70] = this.cartIgnoreWrite;
      this.memoryHighWriter[0x74] = this.memoryWriter[0xff74] = this.cartIgnoreWrite;
    }
  }

  recompileBootIOWriteHandling() {
    //Boot I/O Registers:
    if (this.inBootstrap) {
      this.memoryHighWriter[0x50] = this.memoryWriter[0xff50] = function(
        parentObj,
        address,
        data
      ) {
        cout("Boot ROM reads blocked: Bootstrap process has ended.", 0);
        parentObj.inBootstrap = false;
        parentObj.disableBootROM(); //Fill in the boot ROM ranges with ROM  bank 0 ROM ranges
        parentObj.memory[0xff50] = data; //Bits are sustained in memory?
      };
      if (this.cGBC) {
        this.memoryHighWriter[0x6c] = this.memoryWriter[0xff6c] = function(
          parentObj,
          address,
          data
        ) {
          if (parentObj.inBootstrap) {
            parentObj.cGBC = (data & 0x1) == 0;
            //Exception to the GBC identifying code:
            if (
              parentObj.name + parentObj.gameCode + parentObj.ROM[0x143] ==
              "Game and Watch 50"
            ) {
              parentObj.cGBC = true;
              cout(
                "Created a boot exception for Game and Watch Gallery 2 (GBC ID byte is wrong on the cartridge).",
                1
              );
            }
            cout("Booted to GBC Mode: " + parentObj.cGBC, 0);
          }
          parentObj.memory[0xff6c] = data;
        };
      }
    } else {
      //Lockout the ROMs from accessing the BOOT ROM control register:
      this.memoryHighWriter[0x50] = this.memoryWriter[0xff50] = this.cartIgnoreWrite;
    }
  }
}
