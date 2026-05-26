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
    private static final double RISK_AMOUNT_LIMIT = 90.0;
    private static final int RISK_PORTION_LIMIT = 15;

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
        String customerEmail = String.valueOf(request.getOrDefault("customerEmail", "")).toLowerCase();
        double amount = asDouble(request.get("amount"));
        int totalPortions = asInt(request.get("totalPortions"));
        Map<String, Object> response = new LinkedHashMap<>();

        response.put("paymentProvider", "camel-demo-bank");
        response.put("paymentReference", "PAY-" + Instant.now().toEpochMilli());
        response.put("scenario", scenario);
        response.put("evaluatedAmount", amount);
        response.put("evaluatedTotalPortions", totalPortions);

        if ("p1PaymentTimeout".equals(scenario)
            || customerEmail.contains("timeout")
            || customerEmail.contains("noresponse")) {
            response.put("paymentResponded", false);
            response.put("transactionSuccessful", false);
            response.put("bankStatus", "NO_RESPONSE");
            response.put("message", "Mock bank did not provide a payment result.");
        } else if ("p1PaymentFailed".equals(scenario)
            || customerEmail.contains("fail")
            || customerEmail.contains("decline")
            || amount > RISK_AMOUNT_LIMIT
            || totalPortions > RISK_PORTION_LIMIT) {
            response.put("paymentResponded", true);
            response.put("transactionSuccessful", false);
            response.put("bankStatus", "DECLINED");
            response.put("message", declineReason(scenario, customerEmail, amount, totalPortions));
        } else {
            response.put("paymentResponded", true);
            response.put("transactionSuccessful", true);
            response.put("bankStatus", "APPROVED");
            response.put("message", "Mock bank approved the payment after checking amount, portions and customer email.");
        }

        log.info("Camel payment integration request: {}", request);
        log.info("Camel payment integration response: {}", response);

        exchange.getMessage().setBody(MAPPER.writeValueAsString(response));
    }

    private double asDouble(Object value) {
        if (value instanceof Number) {
            return ((Number) value).doubleValue();
        }

        if (value == null) {
            return 0.0;
        }

        try {
            return Double.parseDouble(String.valueOf(value));
        } catch (NumberFormatException ignored) {
            return 0.0;
        }
    }

    private int asInt(Object value) {
        if (value instanceof Number) {
            return ((Number) value).intValue();
        }

        if (value == null) {
            return 0;
        }

        try {
            return Integer.parseInt(String.valueOf(value));
        } catch (NumberFormatException ignored) {
            return 0;
        }
    }

    private String declineReason(String scenario, String customerEmail, double amount, int totalPortions) {
        if ("p1PaymentFailed".equals(scenario)) {
            return "Mock bank declined the payment because the demo failure scenario was selected.";
        }

        if (customerEmail.contains("fail") || customerEmail.contains("decline")) {
            return "Mock bank declined the payment because the customer email selected the failure demo path.";
        }

        if (amount > RISK_AMOUNT_LIMIT) {
            return "Mock bank declined the payment because the order amount is above the risk limit.";
        }

        if (totalPortions > RISK_PORTION_LIMIT) {
            return "Mock bank declined the payment because the order has too many portions.";
        }

        return "Mock bank declined the payment.";
    }
}
