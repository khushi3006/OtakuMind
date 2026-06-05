import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy · OtakuMind",
  description:
    "How OtakuMind collects, uses, and protects your information across the OtakuMind website and mobile app.",
};

const CONTACT_EMAIL = "kk4827182@gmail.com";

export default function PrivacyPage() {
  return (
    <main className="dashboard">
      <header className="header">
        <div className="brand">
          <h1>Privacy Policy</h1>
          <p className="tagline">Last updated: June 5, 2026</p>
        </div>
      </header>

      <article className="legal">
        <section className="legal-section">
          <h2>1. Introduction</h2>
          <p>
            OtakuMind (&ldquo;OtakuMind&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;) is an
            anime-tracking service available as a website and a mobile app. This Privacy Policy
            explains what information we collect, why we collect it, and the choices you have. It
            applies to both the OtakuMind website and the OtakuMind mobile app.
          </p>
        </section>

        <section className="legal-section">
          <h2>2. Information we collect</h2>
          <ul>
            <li>
              <strong>Account information you provide:</strong> your email address, username,
              display name, and &mdash; for email sign-ups &mdash; a password, which we store only
              as a salted hash. You may also add an optional profile avatar.
            </li>
            <li>
              <strong>Sign-in providers:</strong> if you sign in with Google or Apple, we receive
              basic profile information (such as your name and email) from them to create and
              identify your account. We never receive your Google or Apple password.
            </li>
            <li>
              <strong>Content you create:</strong> the anime you track and their statuses, any
              ratings or notes you add, and your follow relationships with other users.
            </li>
            <li>
              <strong>Minimal technical data:</strong> standard server logs needed to operate and
              secure the service (such as request metadata). We do not run third-party advertising
              or analytics trackers.
            </li>
          </ul>
        </section>

        <section className="legal-section">
          <h2>3. How we use your information</h2>
          <p>We use your information to:</p>
          <ul>
            <li>create and maintain your account;</li>
            <li>provide core features such as tracking lists, profiles, and following;</li>
            <li>authenticate you and keep your account secure;</li>
            <li>respond to your questions and requests.</li>
          </ul>
        </section>

        <section className="legal-section">
          <h2>4. How we share information</h2>
          <p>
            We do <strong>not</strong> sell your personal data. We share information only with the
            service providers that operate OtakuMind on our behalf: Google and Apple (sign-in),
            Vercel (hosting), and Neon (our PostgreSQL database). We may also disclose information
            if required to do so by law.
          </p>
        </section>

        <section className="legal-section">
          <h2>5. Your choices and rights</h2>
          <ul>
            <li>
              <strong>Export your data</strong> from within the app (Profile &rarr; settings &rarr;
              Export).
            </li>
            <li>
              <strong>Edit</strong> your profile and account details at any time in the app.
            </li>
            <li>
              <strong>Delete your account</strong> in the app (Profile &rarr; settings &rarr; Delete
              Account), which removes your account and associated data.
            </li>
            <li>
              Contact us for any access or deletion request you are unable to complete in the app.
            </li>
          </ul>
        </section>

        <section className="legal-section">
          <h2>6. Data retention</h2>
          <p>
            We keep your information while your account is active. When you delete your account, we
            delete or anonymize your associated data, except where we must retain limited records
            for legal or security reasons.
          </p>
        </section>

        <section className="legal-section">
          <h2>7. Security</h2>
          <p>
            Data is transmitted over HTTPS and stored in a managed PostgreSQL database. Passwords
            are stored only as salted hashes. No method of transmission or storage is completely
            secure, but we take reasonable measures to protect your information.
          </p>
        </section>

        <section className="legal-section">
          <h2>8. Children&rsquo;s privacy</h2>
          <p>
            OtakuMind is not directed to children under 13 (or the minimum age required in your
            region). We do not knowingly collect personal information from them. If you believe a
            child has provided us information, please contact us and we will remove it.
          </p>
        </section>

        <section className="legal-section">
          <h2>9. Changes to this policy</h2>
          <p>
            We may update this Privacy Policy from time to time. When we do, we will revise the
            &ldquo;Last updated&rdquo; date above, and material changes will be reflected on this
            page.
          </p>
        </section>

        <section className="legal-section">
          <h2>10. Contact</h2>
          <p>
            Questions or requests about this policy or your data? Email us at{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className="legal-link">
              {CONTACT_EMAIL}
            </a>
            .
          </p>
        </section>
      </article>
    </main>
  );
}
