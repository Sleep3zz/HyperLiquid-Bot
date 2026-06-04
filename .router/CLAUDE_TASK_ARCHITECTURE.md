# MODEL ROUTER TASK ASSIGNMENT
## Paper Trading System Architecture Design

**Task ID**: ARCH-2024-0604-001  
**Assigned to**: Claude (Sonnet)  
**Priority**: High  
**Status**: In Progress

---

## Task Description

Design comprehensive architecture for paper trading system using HyperLiquidAlgoBot's native components.

## Requirements

### Functional Requirements
1. Virtual portfolio with $1,000 initial capital
2. Trade simulation without real money
3. Position tracking (size, entry, PnL)
4. Performance metrics calculation
5. Integration with BBRSIStrategy
6. ML parameter optimization support
7. Risk management (stop-loss, take-profit)

### Non-Functional Requirements
- Modular design
- Clear separation of concerns
- Testable components
- Configurable parameters
- Event-driven updates

## Deliverables Expected

1. **System Architecture Diagram**
   - Component relationships
   - Data flow
   - Integration points

2. **Component Specifications**
   - PaperTradingEngine interface
   - Strategy adapter
   - Risk manager integration
   - Performance tracker

3. **Data Models**
   - Position structure
   - Trade record
   - Portfolio state
   - Performance metrics

4. **Sequence Diagrams**
   - Trade execution flow
   - Position update flow
   - Performance calculation flow

5. **Integration Guide**
   - How to connect to BBRSIStrategy
   - How to use MLOptimizer
   - Configuration options

---

## CLAUDE'S ANALYSIS APPROACH

1. Review existing bot components
2. Identify integration points
3. Design clean interfaces
4. Document architecture decisions
5. Provide implementation guidance

**Start by examining:**
- src/strategy/BBRSIStrategy.js
- src/backtesting/ml_optimizer.js
- src/backtesting/RiskManager.js
- Existing backtesting infrastructure
