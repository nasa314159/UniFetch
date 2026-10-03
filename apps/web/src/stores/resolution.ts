import { defineStore } from 'pinia';
import { ref, shallowRef } from 'vue';
import { asUniFetchError, type UniFetchError } from '@unifetch/core';
import {
  createResolver,
  type InstagramResolutionResult,
} from '@unifetch/meta-resolver';
import { WebRuntime } from '@unifetch/runtime-web';
const resolver = createResolver(new WebRuntime());
export const useResolutionStore = defineStore('resolution', () => {
  const state = ref<'IDLE' | 'RESOLVING' | 'RESOLVED' | 'ERROR'>('IDLE');
  const result = shallowRef<InstagramResolutionResult | null>(null);
  const error = shallowRef<UniFetchError | null>(null);
  async function resolve(input: string) {
    if (state.value === 'RESOLVING') return;
    state.value = 'RESOLVING';
    result.value = null;
    error.value = null;
    try {
      result.value = await resolver.resolve(input);
      state.value = 'RESOLVED';
    } catch (cause) {
      error.value = asUniFetchError(cause);
      state.value = 'ERROR';
    }
  }
  function fail(errorValue: UniFetchError) {
    error.value = errorValue;
    result.value = null;
    state.value = 'ERROR';
  }
  return { state, result, error, resolve, fail };
});
