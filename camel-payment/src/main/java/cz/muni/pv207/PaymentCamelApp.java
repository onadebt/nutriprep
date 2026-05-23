package cz.muni.pv207;

import org.apache.camel.main.Main;

public final class PaymentCamelApp {
    private PaymentCamelApp() {
    }

    public static void main(String[] args) throws Exception {
        Main main = new Main();
        main.configure().addRoutesBuilder(new PaymentRoute());
        main.run(args);
    }
}
