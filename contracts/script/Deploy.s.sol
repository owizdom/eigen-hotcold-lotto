// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {TEEVerifier} from "../src/TEEVerifier.sol";
import {HotColdLotto} from "../src/HotColdLotto.sol";

contract Deploy is Script {
    function run() external {
        address enclaveAddress = vm.envAddress("ENCLAVE_ADDRESS");

        vm.startBroadcast();

        TEEVerifier verifier = new TEEVerifier(enclaveAddress);
        console2.log("TEEVerifier deployed at:", address(verifier));

        HotColdLotto lotto = new HotColdLotto(address(verifier));
        console2.log("HotColdLotto deployed at:", address(lotto));

        vm.stopBroadcast();
    }
}
