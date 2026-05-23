# Worker Scenarios

Change the default scenario in `worker.js`:

```js
const ACTIVE_SCENARIO = "happyPath";
const ACTIVE_P1_SCENARIO = "p1HappyPath";
```

You can also override it per process instance by starting with a variable:

```json
{
  "scenario": "delayedWithEmail",
  "p1Scenario": "p1PaymentFailed",
  "sendto": "customer@example.com"
}
```

Delivery planning scenarios:

- `happyPath`: routes feasible, no delay, delivery succeeds.
- `routeProblemThenRetry`: routes not feasible, token goes to capacity review.
- `delayedWithEmail`: delivery delayed, email task runs, delivery succeeds.
- `failedThenRedelivery`: delivery fails first, redelivery is possible.
- `failedNoRedelivery`: delivery fails and no redelivery is possible.

P1 meal-ordering scenarios:

- `p1HappyPath`: order valid, items available, payment succeeds, confirmation worker returns sent.
- `p1InvalidOrder`: order validation fails, order is rejected.
- `p1ItemsUnavailable`: items unavailable, order is rejected.
- `p1PaymentFailed`: payment result arrives, but transaction fails.
- `p1PaymentTimeout`: bank does not respond, token goes to the timer/manual-resolution path.

Allergen conflicts are not scenario-forced anymore. The `check-allergen-conflict` worker evaluates the real customer allergens from the order form against the DMN/menu allergens.

The `generate-receipt` worker builds receipt text/HTML from the submitted order form and gives each selected meal a deterministic demo price variation, so the receipt is realistic but stable for the same order.
