/**
 * RSA public key embedded in the bundled ninecli 0.1.7 binary.
 *
 * This is a public, 1024-bit PKCS#1 key recovered from the binary's static
 * data. It is shared by the protocol adapters; callers may override
 * it explicitly, but must validate the complete request against the ninecli
 * oracle before using it for a service request.
 */
export const ninebotCandidateRsaPublicKeyPem = `-----BEGIN RSA PUBLIC KEY-----
MIGJAoGBANPebRz/zL1zXc/NoVsBMSD5nB2Sk9wLLRXbVUoEFLHXpyRW0sREBDsQ
fx3oOqARvLNrIDCVB3WAOFSbHbuENZp9ev3969RmSQF6Byw2cqsiWH3eU8pxyOT4
sNdLVOcMggWJOVJs2dpjB6Ej/2lRsoIjeHvITSm6bqEmH/1C0Y+XAgMBAAE=
-----END RSA PUBLIC KEY-----`;
