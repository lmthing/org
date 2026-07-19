export function formatStopoverPlan(
  arrivalDate: string,
  departureDate: string,
  hotels: { arrival: { name: string; address: string; costUSD: number; nights: number }; departure: { name: string; address: string; costUSD: number; nights: number } },
  flights: { arrivalToCairo: { airline: string; flightNumber: string; from: string; arrival: string }; departureFromCairo: { airline: string; flightNumber: string; to: string; departure: string }; cairoToDest: { airline: string; flightNumber: string; to: string; departure: string }; returnToCairo: { airline: string; flightNumber: string; from: string; arrival: string } },
  sightseeing: { arrivalStopover: string[]; departureStopover: string[] },
  visa: { type: string; costPerPersonUSD: number; travelers: number; requirements: string[] },
  transport: { arrivalStopover: string; departureStopover: string }
): { 
  summary: string;
  segments: { 
    label: string; 
    dates: string; 
    hotel: string; 
    sightseeing: string[]; 
    transport: string; 
    flightOut: string;
  }[];
  totalCosts: { 
    hotelsUSD: number; 
    visaUSD: number; 
    flightsNote: string; 
  };
  tips: string[];
} {
  // format a complete stopover plan combining itinerary, logistics, and tips into a readable advisory
  const visaTotal = visa.costPerPersonUSD * visa.travelers;
  
  const segments = [
    {
      label: "Arrival Stopover",
      dates: arrivalDate,
      hotel: hotels.arrival.name + " (" + hotels.arrival.address + ") — " + hotels.arrival.nights + " night(s), $" + hotels.arrival.costUSD,
      sightseeing: sightseeing.arrivalStopover,
      transport: transport.arrivalStopover,
      flightOut: flights.cairoToDest.airline + " " + flights.cairoToDest.flightNumber + " to " + flights.cairoToDest.to + " at " + flights.cairoToDest.departure,
    },
    {
      label: "Departure Stopover",
      dates: departureDate,
      hotel: hotels.departure.name + " (" + hotels.departure.address + ") — " + hotels.departure.nights + " night(s), $" + hotels.departure.costUSD,
      sightseeing: sightseeing.departureStopover,
      transport: transport.departureStopover,
      flightOut: flights.departureFromCairo.airline + " " + flights.departureFromCairo.flightNumber + " to " + flights.departureFromCairo.to + " at " + flights.departureFromCairo.departure,
    },
  ];
  
  const tips = [
    "Print your e-visa: " + visa.requirements.join("; "),
    "Arrival flight: " + flights.arrivalToCairo.airline + " " + flights.arrivalToCairo.flightNumber + " from " + flights.arrivalToCairo.from + ", arrives " + flights.arrivalToCairo.arrival,
    "Return flight to Cairo: " + flights.returnToCairo.airline + " " + flights.returnToCairo.flightNumber + " from " + flights.returnToCairo.from + ", arrives " + flights.returnToCairo.arrival,
    "Total flights cost is noted separately — verify with booking references before travel.",
    "Carry local currency (EGP) for taxis, bazaar purchases, and small cafes.",
  ];
  
  const summary = "Cairo stopover plan: arrival " + arrivalDate + " at " + hotels.arrival.name + ", departure " + departureDate + " at " + hotels.departure.name + ". Visa: " + visa.type + " ($" + visa.costPerPersonUSD + "/person, $" + visaTotal + " total for " + visa.travelers + " travelers).";
  
  return {
    summary,
    segments,
    totalCosts: {
      hotelsUSD: hotels.arrival.costUSD + hotels.departure.costUSD,
      visaUSD: visaTotal,
      flightsNote: "EUR 2,707 total for both travelers across all 6 legs (Aegean + EgyptAir); confirm with booking references.",
    },
    tips,
  };
}