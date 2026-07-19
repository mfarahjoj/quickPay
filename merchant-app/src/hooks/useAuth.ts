import { useState, useEffect } from 'react';
import { onAuthStateChanged, getCurrentUser } from '../services/auth.service';
import { FirebaseAuthTypes } from '@react-native-firebase/auth';

export function useAuth() {
  const [user, setUser] = useState<FirebaseAuthTypes.User | null>(getCurrentUser());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged((authUser) => {
      setUser(authUser);
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  return {
    user,
    loading,
    isAuthenticated: !!user,
  };
}
