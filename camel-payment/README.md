# Camel Payment Integration

This small Apache Camel app mocks the external Banking system for the P1 meal-ordering process.

It exposes:

```text
POST http://localhost:8081/payment
```

The Camunda worker calls this endpoint from the `process-payment` job. Camel returns process variables used by the BPMN payment gateway:

```json
{
  "paymentResponded": true,
  "transactionSuccessful": true,
  "paymentProvider": "camel-demo-bank",
  "paymentReference": "PAY-..."
}
```

Run it:

```powershell
cd C:\....\camel-payment
mvn exec:java
```

This requires Maven and Java 11+. If `mvn` is not recognized, install Maven or run it from an IDE such as IntelliJ using the `PaymentCamelApp` main class.

Then run the Camunda worker in another terminal:

```powershell
cd C:\...\workers
npm start
```

Scenarios are selected in the process start variables or in `workers/worker.js`:

- `p1HappyPath`: Camel approves payment.
- `p1PaymentFailed`: Camel returns declined payment.
- `p1PaymentTimeout`: Camel returns no payment response, so BPMN follows the no-response/timer path.

No separate fake bank API is needed. The fake bank behavior is inside `PaymentRoute`.
