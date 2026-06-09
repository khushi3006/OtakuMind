'use client';

import { useEntitlement } from '@/lib/query/hooks/auth';
import PaywallModal from '@/components/PaywallModal';

export default function EntitlementGate() {
  const { data: entitlement } = useEntitlement();
  // Block only when we positively know the trial ended. Unknown/undefined → fail open.
  const blocked = entitlement != null && entitlement.active === false;
  return (
    <PaywallModal
      isOpen={blocked}
      forced
      trialEndsAt={entitlement?.trialEndsAt ?? null}
      onClose={() => {}}
    />
  );
}
