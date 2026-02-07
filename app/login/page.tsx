// app/login/page.tsx
// Server component wrapper for the login page
// Uses Suspense so LoginClient can safely read search params on the client

import { Suspense } from "react";
import LoginClient from "./LoginClient";

export default function Page() {
  return (
    // Suspense is required because LoginClient uses useSearchParams()
    // Fallback is null since we don’t need a loading UI here
    <Suspense fallback={null}>
      <LoginClient />
    </Suspense>
  );
}
