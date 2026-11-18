**SOFTWARE ENGINEERING PROJECT GROUP 4**

# **Deliverable 1: Project Title/Planning/Requirements Analysis**

## **Title:** CampusSeat

## **Description** 

CampusSeat is a web-based information system that allows students, staff and other people with campus access to discover university events and reserve a seat online. Administrators create, configure and delete events, setting details such as date, venue and seating capacity, and can choose to open an event to everyone or restrict it to specific schools. 

Registered users browse the available events and apply for a seat by entering their credentials, which are validated against the event’s eligibility rules and saved in the database. If seats remain and the user is eligible, the booking is confirmed automatically and the system issues a registration card as proof of attendance. 

The system tracks available seats in real time so an event is never overbooked, and it gives administrators reports on bookings and attendance. It replaces manual sign-up sheets and scattered emails with one organised, accessible platform.

## **Group Members & Task Allocation**

| Member | Main responsibility | Tasks |
| :---- | :---- | :---- |
| **Edenmike Mwaura Ruhanga:** Frontend  | User interface for both roles | User pages (browse events, booking form, registration card page, login/register) and admin panel pages (event management, bookings view, user management) |
| **Uthman Salyani:** Backend  | Logic, database & security | DB creation, booking transaction (seat check & school eligibility), login & access levels, password hashing, PDF card generation, reports, audit logs |
| **Rick Kyalo:** Documentation, diagrams & mockups | Design & paperwork | Flow chart, use cases, class & ER diagrams, database schema, UI mockups, user manual, testing documentation |

## **Functional Requirements**

| \# | Requirement | Who it serves |
| :---- | :---- | :---- |
| **FR1** | The system shall allow users to register, log in and log out using a secure account, and shall restrict access to features based on role (user or admin) | **Users, admins** |
| **FR2** | The system shall allow admins to create, edit and delete events, including title, description, date, time, venue, seating capacity and an optional school restriction. | **Admins**  |
| **FR3** | The system shall allow users to browse and search upcoming events and view the seats remaining for each. | **Users** |
| **FR4** | The system shall allow an eligible user to book a seat by submitting their credentials (name, school, student number, etc.), automatically confirm the booking if seats remain, reduce the available seats, and prevent duplicate bookings for the same event | **Users** |
| **FR5** | The system shall generate a downloadable, printable PDF registration card for each confirmed booking, showing the user’s name, event, date, venue and a unique booking reference | **Users** |

## 

## **Additional Functional Requirements (added after Deliverable 2, Nov 2026)**

| \# | Requirement | Who it serves |
| :---- | :---- | :---- |
| **FR6** | The system shall let admins check people in at the door by scanning the QR code on the registration card or typing its reference, shall accept each card only once and only for its own event within the check-in window, shall allow a mistaken check-in to be undone, and shall report attendance and no-shows. | **Admins** |
| **FR7** | The system shall classify every event by type (careers, talk, workshop, academic, social, sports, other), show the type visually, and let users filter events by type. | **Users, admins** |
| **FR8** | The system shall let users save events for later and list their saved events. | **Users** |
| **FR9** | The system shall let users correct their own name, student number and school, asking for their password for the last two and refusing a school change while they hold upcoming bookings or waitlist places. | **Users** |
| **FR10** | The system shall keep a user's registration cards available on their phone without an internet connection once they have been opened, and shall remove those copies when the user logs out. | **Users** |

## **Non-Functional Requirements**

| \# | Category | Requirement |
| :---- | :---- | :---- |
| **NFR1** | Security | The system shall store passwords as salted hashes (never plain text) and shall use parameterized queries for all database access to prevent SQL injection. Admin pages shall be accessible only to accounts with the admin role. |
| **NFR2** | Usability | The system shall have a consistent, responsive interface that works on both desktop and mobile browsers, and shall display clear error messages for invalid input (for example, a full event or a school restriction). |
| **NFR3** | Reliability & data integrity | The system shall never allow an event to be booked beyond its seating capacity, even when several users book at the same time, and shall load main pages within 3 seconds under normal use. |

