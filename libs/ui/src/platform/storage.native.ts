import AsyncStorage from '@react-native-async-storage/async-storage'

/**
 * Key/value storage — NATIVE implementation (AsyncStorage). Mirrors `storage.ts` (web/localStorage)
 * so a surface uses one API on both targets. Requires `@react-native-async-storage/async-storage`
 * in the mobile app (verified there). See §7 step 8.
 */
export const storage = {
  getItem(key: string): Promise<string | null> {
    return AsyncStorage.getItem(key)
  },
  setItem(key: string, value: string): Promise<void> {
    return AsyncStorage.setItem(key, value)
  },
  removeItem(key: string): Promise<void> {
    return AsyncStorage.removeItem(key)
  },
}
