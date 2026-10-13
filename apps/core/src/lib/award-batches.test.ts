import { describe, expect, it } from "vitest";
import { validateAwardFilters } from "./award-batches";
describe("award historical filters", () => {
 it("accepts inclusive and one-sided calendar ranges",()=> {
  expect(validateAwardFilters({joinedFrom:"2023-10-13",joinedTo:"2024-04-13"})).toMatchObject({joinedFrom:"2023-10-13",joinedTo:"2024-04-13"});
  expect(validateAwardFilters({joinedTo:"2024-02-29"}).joinedTo).toBe("2024-02-29");
 });
 it.each(["2023-02-29","2024-02-30","2024-13-01","13.10.2023","2024-01-01T00:00:00Z"])("rejects invalid date %s",joinedFrom=>expect(()=>validateAwardFilters({joinedFrom})).toThrow());
 it("rejects a reversed range",()=>expect(()=>validateAwardFilters({joinedFrom:"2024-04-14",joinedTo:"2024-04-13"})).toThrow());
});
