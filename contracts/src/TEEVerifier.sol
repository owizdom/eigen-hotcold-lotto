// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ITEEVerifier} from "./interfaces/ITEEVerifier.sol";

/// @title TEEVerifier — Trust anchor for TEE-signed messages
/// @notice Verifies ECDSA signatures from a trusted enclave address with nonce-based replay prevention
contract TEEVerifier is ITEEVerifier, Ownable {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    address public trustedEnclave;
    mapping(uint256 => bool) public usedNonces;

    error InvalidSignature();
    error NonceAlreadyUsed();
    error ZeroAddress();

    event EnclaveUpdated(address indexed oldEnclave, address indexed newEnclave);

    constructor(address _trustedEnclave) Ownable(msg.sender) {
        if (_trustedEnclave == address(0)) revert ZeroAddress();
        trustedEnclave = _trustedEnclave;
    }

    /// @notice Update the trusted enclave address (post-attestation)
    function setTrustedEnclave(address _newEnclave) external onlyOwner {
        if (_newEnclave == address(0)) revert ZeroAddress();
        address old = trustedEnclave;
        trustedEnclave = _newEnclave;
        emit EnclaveUpdated(old, _newEnclave);
    }

    /// @inheritdoc ITEEVerifier
    function verifySignature(bytes32 messageHash, bytes calldata signature) external view returns (bool) {
        address recovered = messageHash.toEthSignedMessageHash().recover(signature);
        return recovered == trustedEnclave;
    }

    /// @inheritdoc ITEEVerifier
    function verifyAndConsumeNonce(bytes32 messageHash, bytes calldata signature, uint256 nonce) external returns (bool) {
        if (usedNonces[nonce]) revert NonceAlreadyUsed();

        address recovered = messageHash.toEthSignedMessageHash().recover(signature);
        if (recovered != trustedEnclave) revert InvalidSignature();

        usedNonces[nonce] = true;
        return true;
    }
}
