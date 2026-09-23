// Recorded Companies House Public Data API responses, in the documented shapes
// of GET /company/{n}, /company/{n}/officers and
// /company/{n}/persons-with-significant-control.
//
// These are not test doubles. With no COMPANIES_HOUSE_API_KEY on the account
// (risks-and-open-questions.md CH-A) this is what EVERY environment serves,
// and every sync run it feeds is stamped `provider: "fixture"` on
// chase_sync_runs and shown as such in the console. Company numbers, names and
// people are invented; only the SHAPES are real, and they are what the HTTP
// implementation is unit-tested against too.
//
// `@@DUE+n@@` / `@@DUE-n@@` in a confirmation-statement date is resolved by
// the fixture provider to n days from the day it runs, so a demo always has a
// company inside the 30-day risk window and one already overdue, whatever the
// date happens to be. A recorded absolute date would make the fixtures stale
// the week after they were written.
//
// Carried as TypeScript rather than a .json file because the baseline's
// tsconfig does not set `resolveJsonModule`.

export const RECORDED_COMPANIES_HOUSE = {
  "companies": {
    "00000001": {
      "profile": {
        "company_name": "HARBOURSIDE ACCOUNTING LIMITED",
        "company_number": "00000001",
        "company_status": "active",
        "confirmation_statement": {
          "next_due": "@@DUE+12@@",
          "next_made_up_to": "@@DUE-2@@",
          "overdue": false
        }
      },
      "officers": {
        "items": [
          {
            "name": "OKONKWO, Adaeze Ngozi",
            "officer_role": "director",
            "appointed_on": "2019-04-02",
            "links": {
              "officer": {
                "appointments": "/officers/a1b2c3d4e5f6a7b8c9d0e1f2/appointments"
              }
            },
            "identity_verification_details": {
              "anti_money_laundering_supervisory_bodies": [
                "ICAEW"
              ]
            }
          },
          {
            "name": "PRZYBYLSKI, Tomasz",
            "officer_role": "director",
            "appointed_on": "2021-09-14",
            "links": {
              "officer": {
                "appointments": "/officers/b2c3d4e5f6a7b8c9d0e1f2a3/appointments"
              }
            },
            "identity_verification_details": {
              "identity_verified_on": "2026-02-11",
              "anti_money_laundering_supervisory_bodies": [
                "ICAEW"
              ]
            }
          },
          {
            "name": "HALVORSEN, Ingrid",
            "officer_role": "secretary",
            "appointed_on": "2018-01-08",
            "resigned_on": "2025-06-30",
            "links": {
              "officer": {
                "appointments": "/officers/c3d4e5f6a7b8c9d0e1f2a3b4/appointments"
              }
            }
          }
        ],
        "items_per_page": 35,
        "total_results": 3
      },
      "pscs": {
        "items": [
          {
            "name": "Adaeze Ngozi Okonkwo",
            "notified_on": "2019-04-02",
            "links": {
              "self": "/company/00000001/persons-with-significant-control/individual/x9y8z7w6"
            },
            "identity_verification_details": {}
          }
        ],
        "items_per_page": 25,
        "total_results": 1
      }
    },
    "00000002": {
      "profile": {
        "company_name": "PENNINE JOINERY & SHOPFITTING LTD",
        "company_number": "00000002",
        "company_status": "active",
        "confirmation_statement": {
          "next_due": "@@DUE+120@@",
          "next_made_up_to": "@@DUE+106@@",
          "overdue": false
        }
      },
      "officers": {
        "items": [
          {
            "name": "ABERNETHY, Callum James",
            "officer_role": "director",
            "appointed_on": "2015-11-23",
            "links": {
              "officer": {
                "appointments": "/officers/d4e5f6a7b8c9d0e1f2a3b4c5/appointments"
              }
            },
            "identity_verification_details": {
              "identity_verified_on": "2025-12-03"
            }
          }
        ],
        "items_per_page": 35,
        "total_results": 1
      },
      "pscs": {
        "items": [],
        "items_per_page": 25,
        "total_results": 0
      }
    },
    "SC000003": {
      "profile": {
        "company_name": "TAY VALLEY LOGISTICS (SCOTLAND) LIMITED",
        "company_number": "SC000003",
        "company_status": "active",
        "confirmation_statement": {
          "next_due": "@@DUE-5@@",
          "next_made_up_to": "@@DUE-19@@",
          "overdue": true
        }
      },
      "officers": {
        "items": [
          {
            "name": "MACARTHUR, Fiona",
            "officer_role": "director",
            "appointed_on": "2012-03-19",
            "links": {
              "officer": {
                "appointments": "/officers/e5f6a7b8c9d0e1f2a3b4c5d6/appointments"
              }
            },
            "identity_verification_details": {}
          },
          {
            "name": "DEMBELE, Ousmane",
            "officer_role": "director",
            "appointed_on": "2023-07-01",
            "links": {
              "officer": {
                "appointments": "/officers/f6a7b8c9d0e1f2a3b4c5d6e7/appointments"
              }
            }
          }
        ],
        "items_per_page": 35,
        "total_results": 2
      },
      "pscs": {
        "items": [
          {
            "name": "Fiona Macarthur",
            "notified_on": "2016-06-06",
            "links": {
              "self": "/company/SC000003/persons-with-significant-control/individual/a8b7c6d5"
            },
            "identity_verification_details": {}
          }
        ],
        "items_per_page": 25,
        "total_results": 1
      }
    },
    "00000004": {
      "profile": {
        "company_name": "GLASSHOUSE DIGITAL LIMITED",
        "company_number": "00000004",
        "company_status": "dissolved",
        "confirmation_statement": null
      },
      "officers": {
        "items": [],
        "items_per_page": 35,
        "total_results": 0
      },
      "pscs": {
        "items": [],
        "items_per_page": 25,
        "total_results": 0
      }
    }
  }
} as const;
