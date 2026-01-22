/**
 * State - Simple Observable State Class
 * Provides a reactive state container with subscription support
 */

class State {
  constructor(initialState = {}) {
    this._state = initialState;
    this._listeners = new Set();
  }

  /**
   * Get the current state
   * @returns {Object}
   */
  get() {
    return this._state;
  }

  /**
   * Get a specific property from state
   * @param {string} key - Property key
   * @returns {*}
   */
  getProp(key) {
    return this._state[key];
  }

  /**
   * Update the state
   * @param {Object|Function} updates - New state object or updater function
   */
  set(updates) {
    const newState = typeof updates === 'function'
      ? updates(this._state)
      : { ...this._state, ...updates };

    this._state = newState;
    this._notify();
  }

  /**
   * Update a specific property
   * @param {string} key - Property key
   * @param {*} value - New value
   */
  setProp(key, value) {
    this._state[key] = value;
    this._notify();
  }

  /**
   * Subscribe to state changes
   * @param {Function} listener - Callback function
   * @returns {Function} - Unsubscribe function
   */
  subscribe(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  /**
   * Notify all listeners of state change
   * @private
   */
  _notify() {
    this._listeners.forEach(listener => {
      try {
        listener(this._state);
      } catch (e) {
        console.error('State listener error:', e);
      }
    });
  }

  /**
   * Reset state to initial value
   * @param {Object} initialState - Initial state
   */
  reset(initialState = {}) {
    this._state = initialState;
    this._notify();
  }
}

/**
 * Create a simple store with actions
 * @param {Object} initialState - Initial state
 * @param {Object} actions - Action creators
 * @returns {Object} - Store with state and actions
 */
function createStore(initialState, actions = {}) {
  const state = new State(initialState);

  const boundActions = {};
  Object.entries(actions).forEach(([name, action]) => {
    boundActions[name] = (...args) => {
      const result = action(state.get(), ...args);
      if (result !== undefined) {
        state.set(result);
      }
    };
  });

  return {
    state,
    actions: boundActions,
    get: () => state.get(),
    set: (updates) => state.set(updates),
    subscribe: (listener) => state.subscribe(listener)
  };
}

module.exports = { State, createStore };
