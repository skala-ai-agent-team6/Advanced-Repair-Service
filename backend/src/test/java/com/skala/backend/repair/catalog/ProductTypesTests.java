package com.skala.backend.repair.catalog;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import static org.assertj.core.api.Assertions.*;
import java.util.*;

class ProductTypesTests {
    @ParameterizedTest @CsvSource({"VACUUM_CLEANER,vacuum","vacuum,vacuum","WASHING_MACHINE,washing_machine","air_conditioner,air_conditioner","UNKNOWN,unknown","washer,unknown","robot_vacuum,unknown","REFRIGERATOR,unknown","'',unknown"})
    void mapsOnlyExistingExplicitProductCodes(String input,String expected){assertThat(ProductTypes.fromAppliance(input)).isEqualTo(expected);}
    @Test void nullAndUnsupportedCanonicalValuesDoNotBecomeVacuum(){assertThat(ProductTypes.fromAppliance(null)).isEqualTo("unknown");assertThat(ProductTypes.canonical(" WASHING_MACHINE ")).isEqualTo("washing_machine");for(Object value:List.of("washer","robot_vacuum","청소기","",123)){assertThat(ProductTypes.canonical(value)).isEqualTo("unknown");}}
    @Test void conflictingLegacyAliasIsNormalizedWithoutMutatingStoredSnapshot(){
        var snapshot=new LinkedHashMap<String,Object>(Map.of("productType","robot vacuum","appliance_type","WASHING_MACHINE"));var row=new LinkedHashMap<String,Object>();row.put("product_type","washing_machine");row.put("product_snapshot",snapshot);
        var result=ProductTypes.wireRepair(row);assertThat(((Map<?,?>)result.get("product_snapshot")).get("productType")).isEqualTo("washing_machine");assertThat(snapshot.get("productType")).isEqualTo("robot vacuum");
    }
}
