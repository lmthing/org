export function flagGaps(tripData: {
  leg: string;
  dates: { start: string; end: string };
  accommodation: { name: string; cost: number; confirmed: boolean; contact?: string };
  arrival: { method: string; operator?: string; cost?: number; bookingRef?: string };
  departure: { flight: string; time: string; airport: string; confirmed: boolean; transfer?: string; transferCost?: number };
  activities: Array<{ name: string; booked: boolean; cost?: number; requiresTransport?: string }>;
  costs: { lodging: number; transport: number; activities: number; meals: number };
  contacts: string[];
}): { gaps: Array<{ category: string; item: string; severity: "HIGH" | "MEDIUM" | "LOW"; detail: string }>; summary: string } {
  // Scan the trip data for this leg and flag missing bookings, missing costs, and unconfirmed transport (ferry, 05:20 airport transfer, Bongoyo boat) with severity levels.
  const gaps: Array<{ category: string; item: string; severity: "HIGH" | "MEDIUM" | "LOW"; detail: string }> = [];

  // 1. Arrival — ferry from Zanzibar
  if (!tripData.arrival.operator || !tripData.arrival.bookingRef) {
    gaps.push({
      category: "transport",
      item: "Zanzibar-Dar ferry booking",
      severity: "HIGH",
      detail: "No ferry operator or booking reference found. Ferry arrival is the only listed entry method for Aug 17 — without a confirmed booking, this leg has no guaranteed entry."
    });
  }
  if (tripData.arrival.cost === undefined || tripData.arrival.cost === 0) {
    gaps.push({
      category: "cost",
      item: "Ferry fare",
      severity: "MEDIUM",
      detail: "No ferry ticket cost is allocated in the trip spreadsheet. The Zanzibar-Dar ferry typically costs $35-70 USD per person; budget for this is unaccounted."
    });
  }

  // 2. Departure — pre-dawn airport transfer for 05:20 flight
  if (!tripData.departure.transfer) {
    gaps.push({
      category: "transport",
      item: "Airport transfer for 05:20 departure",
      severity: "HIGH",
      detail: "The EgyptAir DAR-CAI flight departs at 05:20 on Aug 19. No airport transfer is arranged. At that hour (likely 02:30-03:00 departure from lodging), ride-hailing or a pre-booked car is essential — walking or public transit is not viable."
    });
  }
  if (tripData.departure.transferCost === undefined || tripData.departure.transferCost === 0) {
    gaps.push({
      category: "cost",
      item: "Airport transfer cost",
      severity: "MEDIUM",
      detail: "No cost is allocated for the pre-dawn airport transfer. A Dar taxi/ride at 03:00 typically costs $10-25 USD."
    });
  }

  // 3. Bongoyo Island — requires boat trip
  const bongoyo = tripData.activities.find(a => a.name.toLowerCase().includes("bongoyo"));
  if (bongoyo) {
    if (!bongoyo.booked) {
      gaps.push({
        category: "activity",
        item: "Bongoyo Island boat trip",
        severity: "MEDIUM",
        detail: "Bongoyo Island is listed as a point of interest but no boat trip is booked. This requires a boat from the mainland (typically departing Slipway or Kigamboni) — cannot be done spontaneously without arranging transport."
      });
    }
    if (bongoyo.cost === undefined || bongoyo.cost === 0) {
      gaps.push({
        category: "cost",
        item: "Bongoyo Island excursion cost",
        severity: "LOW",
        detail: "No cost is allocated for the Bongoyo Island boat trip. Typical cost is $20-40 USD including park fees."
      });
    }
  }

  // 4. Activity bookings — all points of interest are unbooked
  const unbookedActivities = tripData.activities.filter(a => !a.booked && !a.name.toLowerCase().includes("bongoyo"));
  if (unbookedActivities.length > 0) {
    gaps.push({
      category: "activity",
      item: "City exploration activities",
      severity: "LOW",
      detail: "The following points of interest have no bookings: " + unbookedActivities.map(a => a.name).join(", ") + ". These are flexible self-guided attractions (markets, museum, beach) and likely do not need advance booking."
    });
  }
  const unpricedActivities = tripData.activities.filter(a => (a.cost === undefined || a.cost === 0));
  if (unpricedActivities.length > 0) {
    gaps.push({
      category: "cost",
      item: "Activity entry fees and incidentals",
      severity: "LOW",
      detail: "No costs are allocated for: " + unpricedActivities.map(a => a.name).join(", ") + ". Entry fees are modest (National Museum ~$5, markets free) but incidentals like transport between sites are unaccounted."
    });
  }

  // 5. Meals and local transport budget
  if (tripData.costs.meals === 0) {
    gaps.push({
      category: "cost",
      item: "Meals budget for Dar es Salaam",
      severity: "LOW",
      detail: "No meal costs are allocated for the two-day stay. While Sunny Shore B&B may include breakfast, lunch and dinner for 2 days are unbudgeted."
    });
  }
  if (tripData.costs.transport === 0 && !tripData.arrival.operator) {
    gaps.push({
      category: "cost",
      item: "Local transport within Dar",
      severity: "LOW",
      detail: "No local transport budget (bajaji/taxi between sites) is allocated. Moving between Kivukoni, Kariakoo, National Museum, and Coco Beach will require paid transport."
    });
  }

  // 6. Accommodation contact
  if (!tripData.accommodation.contact) {
    gaps.push({
      category: "logistics",
      item: "Accommodation contact info",
      severity: "MEDIUM",
      detail: "Sunny Shore B&B has no phone or email listed. For a pre-dawn checkout and potential late-night airport transfer coordination, having contact details is important."
    });
  }

  // 7. No local contacts at all
  if (tripData.contacts.length === 0) {
    gaps.push({
      category: "logistics",
      item: "Local emergency contact",
      severity: "MEDIUM",
      detail: "No Dar es Salaam-specific contact is available. The trip-wide contacts (Richard from Suricata Safaris, +255 763 222 293) are Arusha-based and not relevant to the Dar city leg."
    });
  }

  const highCount = gaps.filter(g => g.severity === "HIGH").length;
  const medCount = gaps.filter(g => g.severity === "MEDIUM").length;
  const lowCount = gaps.filter(g => g.severity === "LOW").length;

  const summary = "Found " + gaps.length + " gaps: " + highCount + " HIGH (ferry booking, airport transfer), " + medCount + " MEDIUM (ferry cost, transfer cost, Bongoyo boat, accommodation contact, local emergency contact), " + lowCount + " LOW (activity bookings, activity costs, meal budget, local transport budget). Critical actions: book the Zanzibar-Dar ferry for Aug 17 and arrange a pre-dawn taxi/car for the 05:20 Aug 19 flight.";

  return { gaps, summary };
}