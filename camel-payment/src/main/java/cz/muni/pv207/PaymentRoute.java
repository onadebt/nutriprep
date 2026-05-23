package cz.muni.pv207;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.apache.camel.Exchange;
import org.apache.camel.builder.RouteBuilder;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

public class PaymentRoute extends RouteBuilder {
    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Override
    public void configure() {
        from("jetty:http://0.0.0.0:8081/payment?httpMethodRestrict=POST")
            .routeId("bank-payment-route")
            .process(this::mockBankPayment)
            .setHeader(Exchange.CONTENT_TYPE, constant("application/json"));
    }

    private void mockBankPayment(Exchange exchange) throws Exception {
        String body = exchange.getMessage().getBody(String.class);
        Map<String, Object> request = MAPPER.readValue(body, new TypeReference<Map<String, Object>>() {
        });

        String scenario = String.valueOf(request.getOrDefault("p1Scenario", "p1HappyPath"));
        Map<String, Object> response = new LinkedHashMap<>();

        response.put("paymentProvider", "camel-demo-bank");
        response.put("paymentReference", "PAY-" + Instant.now().toEpochMilli());
        response.put("scenario", scenario);

        switch (scenario) {
            case "p1PaymentFailed":
                response.put("paymentResponded", true);
                response.put("transactionSuccessful", false);
                response.put("bankStatus", "DECLINED");
                response.put("message", "Mock bank declined the payment.");
                break;
            case "p1PaymentTimeout":
                response.put("paymentResponded", false);
                response.put("transactionSuccessful", false);
                response.put("bankStatus", "NO_RESPONSE");
                response.put("message", "Mock bank did not provide a payment result.");
                break;
            default:
                response.put("paymentResponded", true);
                response.put("transactionSuccessful", true);
                response.put("bankStatus", "APPROVED");
                response.put("message", "Mock bank approved the payment.");
                break;
        }

        log.info("Camel payment integration request: {}", request);
        log.info("Camel payment integration response: {}", response);

        exchange.getMessage().setBody(MAPPER.writeValueAsString(response));
    }
}
