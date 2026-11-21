// Simulator provider: the reference Provider used by tests, sandbox and the conformance kit.
export const packageName = '@flussctrl/provider-simulator'

export { behaviourSchema, capabilitiesFor, SIMULATE_OUTCOMES, simulatorConfigSchema, type Behaviour, type SimulateOutcome, type SimulatorConfig } from './behaviour.ts'
export { advance, initialGate, pulse, reportedState, type GateParams, type GateState, type PulseMode } from './gate.ts'
export { createSimulator, type SimulatorOptions, type SimulatorProvider } from './simulator.ts'
