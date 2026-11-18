export default function Help() {
  return (
    <div className="container page help">
      <div className="page-head">
        <h1>Help</h1>
        <p>Quick answers for booking seats and running events.</p>
      </div>
      <h2>For students and staff</h2>
      <details open><summary>How do I book a seat?</summary>
        <ol><li>Register for an account, or log in.</li><li>Open an event from the Events page (filter by type, such as Careers or Workshops, or by This week).</li><li>Select Reserve my seat. Your details are filled in from your account; select Edit if they need correcting.</li><li>Your registration card appears straight away, with its QR code. It is also under My bookings.</li></ol></details>
      <details><summary>Can I save an event for later?</summary>
        <p>Yes. Select the bookmark on an event card, or Save for later on the event page. Saved events appear when you select Saved on the Events page. Saving does not hold a seat: book when you are sure.</p></details>
      <details><summary>Can I cancel, or join a waitlist?</summary>
        <p>Cancel from your registration card up to 2 hours before the event starts; the seat goes to the next person on the waitlist. If an event is full, select Join the waitlist: when a seat frees up it is booked for you automatically and we email you.</p></details>
      <details><summary>Why can I not book an event?</summary>
        <ul><li><strong>Event full:</strong> every seat is taken.</li><li><strong>Not open to your school:</strong> the organiser limited the event to certain schools.</li><li><strong>Already booked:</strong> each person can hold one seat per event.</li><li><strong>Event ended:</strong> past events cannot be booked.</li></ul></details>
      <details><summary>I forgot my password</summary>
        <p>Select Forgot your password on the log in page and enter your email. We send you a link to choose a new password; it works once and expires after 30 minutes. Choosing a new password logs you out on every device. No email after a few minutes? Check your spam folder, or ask an administrator to send you a new link.</p></details>
      <details><summary>What do I bring to the event?</summary>
        <p>Bring your registration card, printed or on your phone. Staff scan its QR code at the door (or type the booking reference). Each card works once.</p></details>
      <details><summary>Will my ticket work without internet?</summary>
        <p>Yes, once you have opened My bookings on your phone while online. Your cards and QR codes stay on the phone, so they open at the door even with no signal. You can also add CampusSeat to your home screen from the browser menu. Logging out removes the saved copies.</p></details>
      <details><summary>How do I change my name, student number or school?</summary>
        <p>Go to Account and security (select your name at the top). You can correct your name at any time. Changing your student number or school asks for your password, and your school can only change when you have no upcoming bookings or waitlist places.</p></details>
      <h2 style={{ marginTop: '1.5rem' }}>For administrators</h2>
      <details><summary>How do I check people in at the door?</summary>
        <p>Open Admin panel, then Check-in. Choose the event at your door, then scan each registration card: with a barcode scanner plugged in, with the Scan with camera button on a phone or laptop, or by typing the booking reference. Green means come in; amber means the card was already used (with the time and who scanned it); red means the card is for another event, is not valid, or check-in is not open (it opens 3 hours before the start and closes 3 hours after the end). Made a mistake? Select Undo in the list below. Attendance and no-shows then appear on the dashboard and in reports.</p></details>
      <details><summary>How do I create an event?</summary>
        <p>Open the Admin panel, go to Events and select New event. Fill in the title, date, times, venue and capacity. Leave the school list empty to open the event to everyone, or choose the schools allowed to book.</p></details>
      <details><summary>What happens when I delete an event?</summary>
        <p>The event and all of its bookings are removed. The confirmation dialog shows this before you continue. Capacity cannot be set below the seats already booked.</p></details>
      <details><summary>How do I get a report?</summary>
        <p>Go to Reports, choose the report, filter by date, event or school, then download it as PDF or CSV. Reports carry the date and the CampusSeat name.</p></details>
      <details><summary>Where can I see who did what?</summary>
        <p>The Audit logs page records every sign-in (and failed attempt), role change, password reset, event change, booking, cancellation and report download: who did it, when, from which IP address, and the values before and after a change. Filter by person, action, what it was about, dates or text; select Details to see exactly what changed; and select Export CSV to download what you filtered. Entries can never be edited or deleted.</p></details>
    </div>
  );
}
