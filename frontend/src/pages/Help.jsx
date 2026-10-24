export default function Help() {
  return (
    <div className="container page help">
      <div className="page-head">
        <h1>Help</h1>
        <p>Quick answers for booking seats and running events.</p>
      </div>
      <h2>For students and staff</h2>
      <details open><summary>How do I book a seat?</summary>
        <ol><li>Register for an account, or log in.</li><li>Open an event from the Events page.</li><li>Check your details and select Confirm booking.</li><li>Your registration card appears under My bookings. Download or print it.</li></ol></details>
      <details><summary>Why can I not book an event?</summary>
        <ul><li><strong>Event full:</strong> every seat is taken.</li><li><strong>Not open to your school:</strong> the organiser limited the event to certain schools.</li><li><strong>Already booked:</strong> each person can hold one seat per event.</li><li><strong>Event ended:</strong> past events cannot be booked.</li></ul></details>
      <details><summary>I forgot my password</summary>
        <p>Select Forgot your password on the log in page. Enter your email and student or staff number to set a new password. If that does not work, ask an administrator to reset it.</p></details>
      <details><summary>What do I bring to the event?</summary>
        <p>Bring your registration card (printed or on your phone). The booking reference identifies your seat.</p></details>
      <h2 style={{ marginTop: '1.5rem' }}>For administrators</h2>
      <details><summary>How do I create an event?</summary>
        <p>Open the Admin panel, go to Events and select New event. Fill in the title, date, times, venue and capacity. Leave the school list empty to open the event to everyone, or choose the schools allowed to book.</p></details>
      <details><summary>What happens when I delete an event?</summary>
        <p>The event and all of its bookings are removed. The confirmation dialog shows this before you continue. Capacity cannot be set below the seats already booked.</p></details>
      <details><summary>How do I get a report?</summary>
        <p>Go to Reports, choose the report, filter by date, event or school, then download it as PDF or CSV. Reports carry the date and the CampusSeat name.</p></details>
      <details><summary>Where can I see who did what?</summary>
        <p>The Audit logs page lists logins, bookings, event changes and password resets with the person and time.</p></details>
    </div>
  );
}
